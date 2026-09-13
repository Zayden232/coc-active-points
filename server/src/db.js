import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool(config.db);

// 个别受限环境(如部分沙箱/代理对 mysql2 二进制结果集协议有干扰)下,
// execute() 带结果集的查询会挂起; 设 DB_TEXT_PROTOCOL=1 时改用文本协议
// (query + 客户端参数转义, 行为等价, 仅用于本地 E2E, 生产保持默认 execute)
const textProtocol = process.env.DB_TEXT_PROTOCOL === '1';
if (textProtocol) {
  console.warn('[db] DB_TEXT_PROTOCOL=1: 使用文本协议 (query) 代替预编译 (execute)');
  pool.execute = pool.query.bind(pool);
}

// 预编译查询, 返回行数组
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// 写操作, 返回 result (insertId / affectedRows 等)
export async function run(sql, params = []) {
  const [res] = await pool.execute(sql, params);
  return res;
}

// 在单个连接上跑事务; fn(con) 内用 con.query / con.execute
export async function transaction(fn) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const out = await fn(textProtocol ? { ...con, execute: con.query.bind(con) } : con);
    await con.commit();
    return out;
  } catch (e) {
    try {
      await con.rollback();
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    con.release();
  }
}
