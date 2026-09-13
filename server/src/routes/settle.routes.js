import { Router } from 'express';
import { query, getOne, run, transaction } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { rankingRows } from '../lib/calc.js';
import { CYCLE_TYPES } from '../lib/cycle.js';
import { getAllSettings } from '../lib/settings.js';

export const router = Router();

const validType = (t) => CYCLE_TYPES.includes(t);
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;

// 已结算周期列表
router.get('/list', async (req, res) => {
  const type = req.query.type;
  let where = '1=1';
  const params = [];
  if (type && validType(type)) {
    where += ' AND cycle_type = ?';
    params.push(type);
  }
  try {
    const cycles = await query(
      `SELECT cycle_type, cycle_start, COUNT(*) AS member_count, MAX(created_at) AS settled_at
       FROM weekly_results WHERE ${where}
       GROUP BY cycle_type, cycle_start
       ORDER BY cycle_start DESC, cycle_type DESC LIMIT 30`,
      params
    );
    for (const c of cycles) {
      const w = await getOne(
        `SELECT r.member_id, m.nickname, r.total_score, r.reward_amount
         FROM weekly_results r JOIN members m ON m.id = r.member_id
         WHERE r.cycle_type = ? AND r.cycle_start = ? AND r.rank_no = 1`,
        [c.cycle_type, c.cycle_start]
      );
      c.winner = w || null;
    }
    ok(res, cycles);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 执行结算 (幂等: 已结算则返回 already:true)
router.post('/', async (req, res) => {
  const { type, cycle_start } = req.body || {};
  if (!validType(type)) return fail(res, 400, '无效周期类型');
  if (!ymdRe.test(cycle_start || '')) return fail(res, 400, '周期起始日期格式错误');
  const settings = await getAllSettings();
  const rewardAmount = Number(settings[`reward_${type}_amount`] || 0);
  const rewardRank = Number(settings[`reward_${type}_rank`] || 1);
  try {
    const result = await transaction(async (con) => {
      const [erows] = await con.execute('SELECT COUNT(*) AS c FROM weekly_results WHERE cycle_type = ? AND cycle_start = ?', [type, cycle_start]);
      if (erows[0].c > 0) return { already: true };
      const rows = await rankingRows(con, type, cycle_start, { activeOnly: true });
      for (const r of rows) {
        await con.execute(
          'INSERT INTO weekly_results (cycle_type, cycle_start, member_id, total_score, rank_no, reward_amount) VALUES (?, ?, ?, ?, ?, ?)',
          [type, cycle_start, r.member_id, r.total, r.rank, null]
        );
      }
      let winner = null;
      const champ = rows.find((r) => r.rank === rewardRank && r.total > 0);
      if (champ) {
        await con.execute('UPDATE weekly_results SET reward_amount = ? WHERE cycle_type = ? AND cycle_start = ? AND member_id = ?', [
          rewardAmount,
          type,
          cycle_start,
          champ.member_id,
        ]);
        await con.execute('INSERT INTO reward_logs (cycle_type, cycle_start, member_id, amount, paid, note) VALUES (?, ?, ?, ?, 0, ?)', [
          type,
          cycle_start,
          champ.member_id,
          rewardAmount,
          `${type} 奖励`,
        ]);
        winner = { member_id: champ.member_id, nickname: champ.nickname, total: champ.total, amount: rewardAmount };
      }
      return { already: false, settled: rows.length, winner };
    });
    ok(res, result);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 撤销结算
router.delete('/:type/:cycle_start', async (req, res) => {
  const { type, cycle_start } = req.params;
  if (!validType(type)) return fail(res, 400, '无效周期类型');
  const paid = await getOne('SELECT COUNT(*) AS c FROM reward_logs WHERE cycle_type = ? AND cycle_start = ? AND paid = 1', [type, cycle_start]);
  if (paid.c > 0) return fail(res, 409, '该周期已有已发放红包, 请先标记为未发放');
  try {
    await transaction(async (con) => {
      await con.execute('DELETE FROM weekly_results WHERE cycle_type = ? AND cycle_start = ?', [type, cycle_start]);
      await con.execute('DELETE FROM reward_logs WHERE cycle_type = ? AND cycle_start = ?', [type, cycle_start]);
    });
    ok(res, { undone: true });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 红包记录列表
router.get('/rewards', async (req, res) => {
  let where = '1=1';
  const params = [];
  if (req.query.type) {
    where += ' AND rl.cycle_type = ?';
    params.push(req.query.type);
  }
  if (req.query.paid !== undefined) {
    where += ' AND rl.paid = ?';
    params.push(Number(req.query.paid));
  }
  try {
    const rows = await query(
      `SELECT rl.*, m.nickname FROM reward_logs rl JOIN members m ON m.id = rl.member_id
       WHERE ${where} ORDER BY rl.cycle_start DESC, rl.created_at DESC LIMIT 200`,
      params
    );
    ok(res, rows);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 标记红包发放状态
router.put('/rewards/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { paid } = req.body || {};
  const paidVal = paid ? 1 : 0;
  const paidAt = paid ? new Date() : null;
  await run('UPDATE reward_logs SET paid = ?, paid_at = ? WHERE id = ?', [paidVal, paidAt, id]);
  const row = await getOne('SELECT * FROM reward_logs WHERE id = ?', [id]);
  if (!row) return fail(res, 404, '记录不存在');
  ok(res, row);
});
