#!/usr/bin/env node
// 部落冲突官方 API 同步 CLI(服务器本地执行)
//
//   node scripts/coc-sync.mjs preview [部落标签]        # 只读: 打印差异报告
//   node scripts/coc-sync.mjs apply --yes [部落标签]    # 按报告写库(需 --yes)
//   node scripts/coc-sync.mjs war [部落标签]            # 看当前部落战参战与出手/星数
//   node scripts/coc-sync.mjs set-tag #标签             # 把部落标签写进 settings(前端同步用)
//   node scripts/coc-sync.mjs whoami                    # 检查 token 是否可用
//
// 与线上接口共用同一套逻辑(lib/coc-api.js + routes/coc.routes.js 的 buildDiff/apply 语义),
// 这里直接调用后端进程内的 HTTP 不方便, 因此复刻了 preview 的读取部分(apply 走同一套 action 定义)。
import { pool, getOne, run } from '../src/db.js';
import { getSetting } from '../src/lib/settings.js';
import {
  cocConfigured,
  cocGetClan,
  cocGetMembers,
  cocGetPlayer,
  cocGetCurrentWar,
  normalizeTag,
  warPreferenceToStatus,
} from '../src/lib/coc-api.js';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'preview';
const yes = argv.includes('--yes');
const tagArg = argv.slice(1).find((a) => !a.startsWith('--')) || '';

const STATUS_TEXT = { 0: '绿牌', 1: '红牌', 2: '离开' };

function looksLikeTag(v) {
  return /^#[0-9A-Z]{3,12}$/i.test(String(v || '').trim());
}

async function resolveTag() {
  const tag = normalizeTag(tagArg || (await getSetting('coc_clan_tag', '')));
  if (!tag) {
    console.error('✗ 没有部落标签: 请用 `node scripts/coc-sync.mjs preview #你的标签` 或在设置页保存部落标签');
    process.exit(1);
  }
  return tag;
}

/** 把部落标签写进设置(前端「游戏标签导入」读的就是这个值) */
async function setTag(tag) {
  await run(
    "INSERT INTO settings (skey, svalue) VALUES ('coc_clan_tag', ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)",
    [tag]
  );
  const saved = normalizeTag(await getSetting('coc_clan_tag', ''));
  console.log(`✓ 部落标签已写入设置: ${saved}`);
}

async function whoami() {
  if (!cocConfigured()) {
    console.error('✗ 未配置 COC_API_TOKEN');
    process.exit(1);
  }
  const tag = normalizeTag(tagArg || (await getSetting('coc_clan_tag', '')) || '#2G9JCRQ9Y');
  const { clan } = await cocGetClan(tag);
  console.log(`✓ token 可用: 查询 ${tag} 返回「${clan.name}」(等级 ${clan.clanLevel}, ${clan.members} 人)`);
}

async function war(tag) {
  const { war: w } = await cocGetCurrentWar(tag);
  console.log(`当前部落战状态: ${w.state}`);
  if (w.state === 'notInWar') return;
  console.log(`  队伍规模 ${w.teamSize} | 每人出手 ${w.attacksPerMember}`);
  for (const m of (w.clan.members || [])) {
    const atk = m.attacks || [];
    const stars = atk.reduce((s, a) => s + Number(a.stars || 0), 0);
    const threes = atk.filter((a) => Number(a.stars) === 3).length;
    console.log(
      `  #${String(m.mapPosition).padEnd(3)} ${String(m.name).padEnd(16)} TH${String(m.townHallLevel).padEnd(3)} 出手${atk.length} 星${stars} 三星${threes}`
    );
  }
}

async function preview(tag) {
  const { clan } = await cocGetClan(tag);
  const { items } = await cocGetMembers(tag);
  console.log(`部落「${clan.name}」(${normalizeTag(clan.tag)}) 等级 ${clan.clanLevel} · 官方成员 ${items.length} 人`);

  const local = await pool.query('SELECT id, nickname, tag, status, red_since FROM members WHERE deleted_at IS NULL ORDER BY id');
  const rows = local[0];
  const byTag = new Map(rows.filter((m) => looksLikeTag(m.tag)).map((m) => [normalizeTag(m.tag), m]));
  const byName = new Map(rows.map((m) => [String(m.nickname || '').trim().toLowerCase(), m]));

  const actions = [];
  console.log('\n成员对比:');
  for (const raw of items) {
    let pref = null;
    let target = null;
    try {
      const { player } = await cocGetPlayer(raw.tag);
      pref = player.warPreference;
      target = warPreferenceToStatus(player);
    } catch (e) {
      pref = `error:${e.reason || e.message}`;
    }
    let hit = byTag.get(normalizeTag(raw.tag)) || byName.get(String(raw.name).trim().toLowerCase()) || null;
    const matched = hit ? (normalizeTag(hit.tag) === normalizeTag(raw.tag) ? 'tag' : '昵称') : '新成员';
    console.log(
      `  ${String(raw.name).padEnd(16)} ${normalizeTag(raw.tag).padEnd(12)} 战意=${String(pref).padEnd(6)} ` +
        `本地=${hit ? `${hit.nickname}(${STATUS_TEXT[hit.status]})` : '—'}  匹配=${matched}`
    );
    if (!hit) {
      actions.push({ type: 'add', nickname: raw.name, tag: normalizeTag(raw.tag), status: target === null ? 0 : target });
    } else {
      if (normalizeTag(hit.tag) !== normalizeTag(raw.tag)) actions.push({ type: 'tag', member_id: hit.id, nickname: hit.nickname, tag: normalizeTag(raw.tag) });
      if (target !== null && Number(hit.status) !== target) actions.push({ type: 'status', member_id: hit.id, nickname: hit.nickname, to: target });
      if (Number(hit.status) === 2) actions.push({ type: 'rejoin', member_id: hit.id, nickname: hit.nickname });
    }
  }

  const apiTags = new Set(items.map((m) => normalizeTag(m.tag)));
  const apiNames = new Set(items.map((m) => String(m.name).trim().toLowerCase()));
  const leaves = rows.filter((m) => Number(m.status) !== 2).filter((m) => {
    const t = looksLikeTag(m.tag) ? normalizeTag(m.tag) : '';
    if (t && apiTags.has(t)) return false;
    if (apiNames.has(String(m.nickname || '').trim().toLowerCase())) return false;
    return true;
  });

  console.log('\n建议动作:');
  for (const a of actions) {
    console.log(`  新增/更新 ${a.type === 'add' ? `新增成员 ${a.nickname} ${a.tag}` : `${a.nickname} -> ${a.type}${a.to !== undefined ? ' ' + STATUS_TEXT[a.to] : ''}`}`);
  }
  for (const l of leaves) console.log(`  离开 ${l.nickname}(本地 ${STATUS_TEXT[l.status]}) -> 记为离开`);
  if (!actions.length && !leaves.length) console.log('  (无需变更)');

  if (cmd !== 'apply') {
    console.log('\n(只读预览; 要写库请加 apply --yes)');
    return { actions, leaves };
  }
  if (!yes) {
    console.error('\n✗ apply 需要显式 --yes');
    process.exit(1);
  }

  console.log('\n开始写库...');
  const batchId = `coc-cli-${Date.now().toString(36)}`;
  for (const a of actions) {
    try {
      if (a.type === 'add') {
        await run('INSERT INTO members (nickname, tag, join_date, status, red_since, note) VALUES (?, ?, NULL, ?, ?, ?)', [
          a.nickname, a.tag, a.status, a.status === 1 ? new Date().toISOString().slice(0, 10) : null, '游戏内同步(CLI)',
        ]);
        console.log(`  + 新增 ${a.nickname} (${STATUS_TEXT[a.status]})`);
      } else if (a.type === 'tag') {
        await run('UPDATE members SET tag = ? WHERE id = ?', [a.tag, a.member_id]);
        console.log(`  ~ ${a.nickname} 标签写为 ${a.tag}`);
      } else {
        const cur = (await getOne('SELECT * FROM members WHERE id = ?', [a.member_id]));
        if (!cur) continue;
        const next = a.type === 'rejoin' ? 0 : a.to;
        await run('UPDATE members SET status = ?, red_since = ?, deleted_at = NULL WHERE id = ?', [
          next, next === 1 ? (cur.status === 1 ? cur.red_since : new Date().toISOString().slice(0, 10)) : null, a.member_id,
        ]);
        console.log(`  ~ ${a.nickname} 状态 ${STATUS_TEXT[cur.status]} -> ${STATUS_TEXT[next]}`);
      }
    } catch (e) {
      console.error(`  ✗ ${a.nickname || a.member_id}: ${e.message}`);
    }
  }
  for (const l of leaves) {
    await run('UPDATE members SET status = 2, red_since = NULL WHERE id = ?', [l.member_id]);
    console.log(`  ~ ${l.nickname} -> 离开`);
  }
  // CLI 写库也留审计(actor 记为 cli)
  await run(
    "INSERT INTO member_status_logs (member_id, old_status, new_status, old_red_since, new_red_since, reason, batch_id, actor_user_id, actor_username, actor_role) SELECT id, NULL, status, NULL, red_since, '游戏内同步(CLI)', ?, NULL, 'cli', 'cli' FROM members WHERE id IN (" +
      [...actions.map((a) => a.member_id).filter(Boolean), ...leaves.map((l) => l.member_id)].map(() => '?').join(',') + ')',
    [batchId, ...[...actions.map((a) => a.member_id).filter(Boolean), ...leaves.map((l) => l.member_id)]]
  ).catch(() => {});
  console.log(`\n✓ 完成 (batch_id=${batchId})`);
  return { actions, leaves };
}

try {
  if (cmd === 'set-tag') {
    const tag = normalizeTag(tagArg);
    if (!tag || !/^#[0-9A-Z]{3,12}$/.test(tag)) {
      console.error('✗ 用法: node scripts/coc-sync.mjs set-tag #2G9JCRQ9Y');
      process.exitCode = 1;
    } else {
      await setTag(tag);
    }
  } else {
    const tag = await resolveTag();
    if (cmd === 'whoami') await whoami();
    else if (cmd === 'war') await war(tag);
    else await preview(tag);
  }
} catch (e) {
  console.error('✗ ' + e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
