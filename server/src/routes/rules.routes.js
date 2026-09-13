import { Router } from 'express';
import { query, getOne, run } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { withQuickValues, withQuickValuesList } from '../lib/rules.js';

export const router = Router();

function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get('/', async (req, res) => {
  try {
    ok(res, withQuickValuesList(await query('SELECT * FROM score_rules ORDER BY sort_order, id')));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 快捷数量: 接受数组或逗号分隔字符串, 只保留正数, 最多 4 个, 存成逗号分隔
// 必须与 /api/records 的 quantity 同单位(这里不做任何隐式换算)
function normalizeQuickValues(v, fallback = '') {
  if (v === undefined || v === null) return fallback;
  const list = Array.isArray(v) ? v : String(v).split(/[,，\s]+/);
  const values = [...new Set(
    list
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  )].slice(0, 4);
  return values.join(',');
}

router.post('/', async (req, res) => {
  const { name, unit = '', score_per_unit = 1, weekly_cap = null, quick_values = '', enabled = 1, sort_order = 0 } = req.body || {};
  if (!name || !String(name).trim()) return fail(res, 400, '积分项名称不能为空');
  try {
    const r = await run(
      'INSERT INTO score_rules (name, unit, score_per_unit, weekly_cap, quick_values, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        String(name).trim(),
        unit,
        score_per_unit,
        weekly_cap === '' || weekly_cap === null ? null : weekly_cap,
        normalizeQuickValues(quick_values),
        enabled ? 1 : 0,
        sort_order,
      ]
    );
    ok(res, withQuickValues(await getOne('SELECT * FROM score_rules WHERE id = ?', [r.insertId])));
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, '积分项名称已存在');
    fail(res, 500, e.message);
  }
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const cur = await getOne('SELECT * FROM score_rules WHERE id = ?', [id]);
  if (!cur) return fail(res, 404, '积分项不存在');
  const b = req.body || {};
  const name = b.name ?? cur.name;
  const cap = b.weekly_cap !== undefined ? (b.weekly_cap === '' || b.weekly_cap === null ? null : b.weekly_cap) : cur.weekly_cap;
  const quick = normalizeQuickValues(b.quick_values, cur.quick_values || '');
  try {
    await run('UPDATE score_rules SET name = ?, unit = ?, score_per_unit = ?, weekly_cap = ?, quick_values = ?, enabled = ?, sort_order = ? WHERE id = ?', [
      String(name).trim(),
      b.unit ?? cur.unit,
      b.score_per_unit ?? cur.score_per_unit,
      cap,
      quick,
      b.enabled !== undefined ? (b.enabled ? 1 : 0) : cur.enabled,
      b.sort_order ?? cur.sort_order,
      id,
    ]);
    ok(res, withQuickValues(await getOne('SELECT * FROM score_rules WHERE id = ?', [id])));
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, '积分项名称已存在');
    fail(res, 500, e.message);
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const cnt = await getOne('SELECT COUNT(*) AS c FROM score_records WHERE rule_id = ?', [id]);
  if (cnt.c > 0) return fail(res, 409, '该积分项已有流水记录, 不能删除, 建议改为停用');
  const r = await run('DELETE FROM score_rules WHERE id = ?', [id]);
  if (!r.affectedRows) return fail(res, 404, '积分项不存在');
  ok(res, { deleted: id });
});
