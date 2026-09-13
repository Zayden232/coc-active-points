// 可靠地结束子进程(Windows 上 child.kill() 有时只让 libuv 认为进程没了,
// 实际 mysqld 还在跑, 于是数据目录被锁 → 下次 rmSync 失败 → 留下 .e2e-mysql-<pid> 垃圾目录)。
import { spawnSync } from 'node:child_process';

export function killTree(child) {
  if (!child || !child.pid) return false;
  if (child.exitCode !== null || child.signalCode !== null) return false;
  if (process.platform === 'win32') {
    // /T 连子进程一起, /F 强制; mysqld 不做优雅关闭也能安全重启(有 redo log)
    const r = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return r.status === 0;
  }
  try {
    child.kill('SIGTERM');
    return true;
  } catch {
    return false;
  }
}

/** 轮询等待端口释放(默认最多等 15 秒) */
export async function waitPortFree(port, host = '127.0.0.1', timeoutMs = 15000) {
  const net = await import('node:net');
  const deadline = Date.now() + timeoutMs;
  const open = () =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      const done = (v) => {
        s.destroy();
        resolve(v);
      };
      s.setTimeout(700);
      s.once('connect', () => done(true));
      s.once('timeout', () => done(false));
      s.once('error', () => done(false));
    });
  while (Date.now() < deadline) {
    if (!(await open())) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
