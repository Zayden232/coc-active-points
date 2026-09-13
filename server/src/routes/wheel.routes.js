import { Router } from 'express';
import { query, getOne, transaction } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { REWARD_POOL, WIN_PROBABILITY, drawReward, pickWeighted, businessDate } from '../lib/wheel.js';

export const router = Router();

const LOCK_HOURS = 24;
// 仅测试用: WHEEL_FORCE=win|lose 可强制分支, WHEEL_FORCE_REWARD 指定奖励 key
const FORCE = process.env.WHEEL_FORCE || '';
const FORCE_REWARD = process.env.WHEEL_FORCE_REWARD || '';

async function activeCosmetics(memberId) {
  return query('SELECT * FROM member_cosmetics WHERE member_id = ? AND expires_at > NOW() ORDER BY kind', [memberId]);
}

// 今日抽奖状态(管理员代抽前查看)
router.get('/status', async (req, res) => {
  const memberId = Number(req.query.member_id);
  if (!Number.isInteger(memberId) || memberId <= 0) return fail(res, 400, '缺少 member_id');
  try {
    const date = businessDate();
    const member = await getOne('SELECT id, nickname, status FROM members WHERE id = ?', [memberId]);
    if (!member) return fail(res, 404, '成员不存在');
    const spin = await getOne('SELECT * FROM wheel_spins WHERE member_id = ? AND draw_date = ?', [memberId, date]);
    ok(res, {
      draw_date: date,
      member,
      can_draw: member.status !== 2 && !spin,
      spin: spin || null,
      cosmetics: await activeCosmetics(memberId),
      probability: WIN_PROBABILITY,
      pool: REWARD_POOL.map(({ key, kind, value, label }) => ({ key, kind, value, label })),
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 当前全部有效外观(供成员列表/排行榜展示; 过期自动不出现在结果里)
router.get('/cosmetics', async (req, res) => {
  try {
    const rows = await query(
      'SELECT member_id, kind, value, label, expires_at FROM member_cosmetics WHERE expires_at > NOW() ORDER BY member_id'
    );
    ok(res, rows);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 每日抽奖: 管理员代抽, 同一成员每天一次(幂等, 重复请求返回当天原结果)
router.post('/spin', async (req, res) => {
  const memberId = Number(req.body && req.body.member_id);
  if (!Number.isInteger(memberId) || memberId <= 0) return fail(res, 400, '缺少 member_id');
  const date = businessDate();
  try {
    const member = await getOne('SELECT id, nickname, status FROM members WHERE id = ?', [memberId]);
    if (!member) return fail(res, 404, '成员不存在');
    if (member.status === 2) return fail(res, 409, '已离开部落的成员不能领取奖励');

    const exist = await getOne('SELECT * FROM wheel_spins WHERE member_id = ? AND draw_date = ?', [memberId, date]);
    if (exist) {
      return ok(res, { already: true, draw_date: date, spin: exist, cosmetics: await activeCosmetics(memberId) });
    }

    // 当天不重复领取同一款外观: 排除本人仍在生效的同种同款
    const active = await query('SELECT kind, value FROM member_cosmetics WHERE member_id = ? AND expires_at > NOW()', [memberId]);
    const excludeKeys = REWARD_POOL.filter((r) => active.some((a) => a.kind === r.kind && a.value === r.value)).map((r) => r.key);

    let reward;
    if (FORCE === 'win') {
      reward = (FORCE_REWARD && REWARD_POOL.find((r) => r.key === FORCE_REWARD)) || pickWeighted(Math.random, { excludeKeys });
    } else if (FORCE === 'lose') {
      reward = null;
    } else {
      reward = drawReward(Math.random, { excludeKeys });
    }

    const spinRow = await transaction(async (con) => {
      try {
        await con.execute(
          'INSERT INTO wheel_spins (draw_date, member_id, reward_key, reward_label) VALUES (?, ?, ?, ?)',
          [date, memberId, reward ? reward.key : '', reward ? reward.label : '谢谢参与']
        );
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return { dup: true };
        throw err;
      }
      let expiresAt = null;
      if (reward) {
        const nowPlus = new Date(Date.now() + LOCK_HOURS * 3600 * 1000);
        const [cur] = await con.execute('SELECT expires_at FROM member_cosmetics WHERE member_id = ? AND kind = ?', [memberId, reward.kind]);
        let expiry = nowPlus;
        if (cur.length && cur[0].expires_at) {
          const had = new Date(cur[0].expires_at);
          if (had > nowPlus) expiry = had; // 取较晚值, 不无限续期
        }
        await con.execute(
          `INSERT INTO member_cosmetics (member_id, kind, value, label, expires_at) VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = ?, label = ?, expires_at = ?`,
          [memberId, reward.kind, reward.value, reward.label, expiry, reward.value, reward.label, expiry]
        );
        expiresAt = expiry;
      }
      return { dup: false, expiresAt };
    });

    if (spinRow.dup) {
      const again = await getOne('SELECT * FROM wheel_spins WHERE member_id = ? AND draw_date = ?', [memberId, date]);
      return ok(res, { already: true, draw_date: date, spin: again, cosmetics: await activeCosmetics(memberId) });
    }

    ok(res, {
      already: false,
      draw_date: date,
      win: !!reward,
      reward: reward ? { key: reward.key, kind: reward.kind, value: reward.value, label: reward.label } : null,
      expires_at: spinRow.expiresAt,
      cosmetics: await activeCosmetics(memberId),
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
