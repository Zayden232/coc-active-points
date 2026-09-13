// ============================================================
// coc-points E2E 场景断言 (由 e2e-run.mjs 调用)
// 覆盖: 健康检查/鉴权/登录限流 → 设置/预算/选项 → 成员 CRUD →
//       规则 CRUD+停用保护 → 批量录入+校验 → 每周封顶 → 跨周聚合
//       (周/月/赛季排行) → 结算幂等/红包发放/撤销保护 → CSV 导出 →
//       备份恢复 → 仪表盘
// ============================================================
import { createPool } from 'mysql2/promise';

let passed = 0;
let failures = [];
let stepNo = 0;

function step(name) {
  stepNo += 1;
  console.log(`\n── [${stepNo}] ${name}`);
}

function check(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  PASS: ${msg}`);
  } else {
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  }
}

async function api(method, urlPath, { token, body, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    return { status: res.status, text: await res.text() };
  }
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const num = (v) => Number(v);

export async function runCases({ baseUrl, accounts, viewerPassword, jwtSecret, db, cocStub }) {
  const A = (p) => `${baseUrl}${p}`;
  const pool = createPool({ ...db, connectionLimit: 4 });

  let token = '';
  let superToken = '';
  let viewerToken = '';

  const login = (username, password) =>
    api('POST', A('/api/auth/login'), { body: { username, password } });

  step('健康检查 (公开)');
  {
    const r = await api('GET', A('/api/health'));
    check(r.status === 200 && r.json && r.json.ok === true, 'GET /api/health -> 200 ok');
  }

  step('访客公开只读: 无 token 可读, 写操作 401');
  {
    const r1 = await api('GET', A('/api/members'));
    check(r1.status === 200 && Array.isArray(r1.json.data), '无 token 读成员列表 -> 200 (匿名访客可浏览)');
    const dash = await api('GET', A('/api/dashboard'));
    check(dash.status === 200 && dash.json.data.member_count === 0, '无 token 读仪表盘 -> 200');
    const w = await api('POST', A('/api/members'), { body: { nickname: '匿名不该成功' } });
    check(w.status === 401, '无 token 写操作 -> 401');
    const d = await api('DELETE', A('/api/members/1'));
    check(d.status === 401, '无 token 删除 -> 401');
    const me = await api('GET', A('/api/auth/me'));
    check(me.status === 200 && me.json.data.role === 'guest' && me.json.data.can_write === false, 'GET /api/auth/me -> 匿名身份 guest');
    // 管理配置/导出对匿名不可见
    for (const p of ['/api/settings', '/api/budget', '/api/backup']) {
      const r = await api('GET', A(p));
      check(r.status === 401, `${p} 匿名 -> 401`);
    }
    const exp = await api('GET', A('/api/export?kind=ranking'), { raw: true });
    check(exp.status === 401, '/api/export 匿名 -> 401');
  }

  step('跨域 CORS: 白名单放行 / 未授权来源拒绝 / 预检不被鉴权拦掉');
  {
    // 直接 fetch 以读取响应头(api() 只返回 body)
    const corsFetch = async (method, p, origin, extra = {}) => {
      const url = A(p);
      const res = await fetch(url, {
        method,
        headers: { Origin: origin, ...(extra.headers || {}) },
      });
      return {
        status: res.status,
        allowOrigin: res.headers.get('access-control-allow-origin'),
        allowMethods: res.headers.get('access-control-allow-methods'),
        allowHeaders: res.headers.get('access-control-allow-headers'),
        allowCreds: res.headers.get('access-control-allow-credentials'),
        vary: res.headers.get('vary'),
      };
    };
    const OK_ORIGIN = 'https://h5.example.com'; // e2e-run.mjs 里配进 CORS_ORIGINS
    const BAD_ORIGIN = 'https://evil.example.com';

    // 1) 白名单来源: 回显该来源 + Vary: Origin
    const g = await corsFetch('GET', '/api/health', OK_ORIGIN);
    check(g.status === 200, '白名单来源 GET /api/health -> 200');
    check(g.allowOrigin === OK_ORIGIN, `白名单来源回显 Allow-Origin: ${OK_ORIGIN}`);
    check(String(g.vary || '').toLowerCase().includes('origin'), '白名单来源带 Vary: Origin(避免缓存串味)');
    check(g.allowCreds === null, '不返回 Allow-Credentials(本项目用 Authorization 头, 不用 Cookie)');

    // 2) 未授权来源: 服务端照常响应, 但不下发跨域头(浏览器自行拦截)
    const b = await corsFetch('GET', '/api/health', BAD_ORIGIN);
    check(b.status === 200 && b.allowOrigin === null, '未授权来源不下发 Allow-Origin(浏览器会拦)');

    // 3) 预检: 必须在这里就 204 结束, 不能被"非 GET 需管理员"拦成 401/403
    const pre = await corsFetch('OPTIONS', '/api/members', OK_ORIGIN, {
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    check(pre.status === 204, `白名单来源 OPTIONS /api/members -> 204 (实际 ${pre.status}, 预检未被鉴权拦截)`);
    check(/POST/.test(pre.allowMethods || ''), '预检 Allow-Methods 含 POST');
    check(/authorization/i.test(pre.allowHeaders || ''), '预检 Allow-Headers 含 Authorization');

    // 4) 未授权来源的预检直接 403
    const badPre = await corsFetch('OPTIONS', '/api/members', BAD_ORIGIN, {
      headers: { 'Access-Control-Request-Method': 'POST' },
    });
    check(badPre.status === 403 && badPre.allowOrigin === null, '未授权来源 OPTIONS -> 403 且无跨域头');

    // 5) 预检之外的真实写请求仍受鉴权保护(跨域不等于免登录)
    const noTok = await fetch(A('/api/members'), {
      method: 'POST',
      headers: { Origin: OK_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '跨域匿名不该成功' }),
    });
    check(noTok.status === 401, '跨域来源匿名 POST /api/members -> 仍 401(跨域不放宽鉴权)');
  }

  step('鉴权: 伪造 token / 旧版 token 被拒');
  {
    const r2 = await api('GET', A('/api/auth/me'), { token: 'bad.token.here' });
    check(r2.status === 200 && r2.json.data.role === 'guest', '伪造 token 视为匿名(不报错, 也不能写)');
    const w = await api('POST', A('/api/members'), { token: 'bad.token.here', body: { nickname: 'x' } });
    check(w.status === 401, '伪造 token 写操作 -> 401');

    // 旧版(共享口令时代)只带 role 的 token 必须不再可用
    const jwt = (await import('jsonwebtoken')).default;
    const legacy = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '1h' });
    const lw = await api('POST', A('/api/members'), { token: legacy, body: { nickname: '旧token不该成功' } });
    check(lw.status === 401, '旧版仅 role 的 admin token -> 401 (不再有后门)');
    const lme = await api('GET', A('/api/auth/me'), { token: legacy });
    check(lme.json.data.role === 'guest', '旧版 token 在 /auth/me 里是 guest');
  }

  step('登录: 参数校验 / 账号密码错误 / 正确登录 / 访客口令');
  {
    const r0 = await api('POST', A('/api/auth/login'), { body: {} });
    check(r0.status === 400, '缺少用户名或密码 -> 400');
    const rNoUser = await api('POST', A('/api/auth/login'), { body: { username: 'nobody-here', password: 'whatever123' } });
    check(rNoUser.status === 401, '不存在的账号 -> 401');
    const rBad = await login(accounts.admin.username, 'wrong-password');
    check(rBad.status === 401, '密码错误 -> 401');
    check(
      rNoUser.json?.error === rBad.json?.error,
      `账号不存在与密码错误返回同一文案 (${rBad.json?.error})`
    );

    const rAdmin = await login(accounts.admin.username, accounts.admin.password);
    check(rAdmin.status === 200 && !!rAdmin.json?.data?.token, '普通管理员登录成功');
    check(rAdmin.json.data.role === 'admin' && rAdmin.json.data.user?.username === accounts.admin.username, '登录返回 role=admin 与账号信息');
    check(rAdmin.json.data.user?.must_change_password === false, '正常账号不需要强制改密');
    token = rAdmin.json.data.token;

    const rSuper = await login(accounts.super.username, accounts.super.password);
    check(rSuper.status === 200 && rSuper.json.data.role === 'super_admin', '超级管理员登录成功 (role=super_admin)');
    superToken = rSuper.json.data.token;

    const rViewer = await api('POST', A('/api/auth/viewer-login'), { body: { password: viewerPassword } });
    check(rViewer.status === 200 && rViewer.json.data.role === 'viewer', '访客口令登录成功');
    viewerToken = rViewer.json.data.token;
    const rvBad = await api('POST', A('/api/auth/viewer-login'), { body: { password: 'nope' } });
    check(rvBad.status === 401, '访客口令错误 -> 401');

    const meAdmin = await api('GET', A('/api/auth/me'), { token });
    check(meAdmin.json.data.can_write === true && meAdmin.json.data.user?.display_name, '管理员 /auth/me 可写且有显示名');
    const meViewer = await api('GET', A('/api/auth/me'), { token: viewerToken });
    check(meViewer.json.data.role === 'viewer' && meViewer.json.data.can_write === false, '访客 /auth/me 只读');
  }

  step('超级管理员与普通管理员的权限边界');
  {
    const both = await Promise.all([
      api('GET', A('/api/dashboard'), { token }),
      api('GET', A('/api/dashboard'), { token: superToken }),
    ]);
    check(both.every((r) => r.status === 200), '管理员与超级管理员都能访问原有业务接口');

    const adminList = await api('GET', A('/api/admin/users'), { token });
    check(adminList.status === 403, '普通管理员访问账号管理 -> 403');
    const superList = await api('GET', A('/api/admin/users'), { token: superToken });
    check(superList.status === 200 && Array.isArray(superList.json.data), '超级管理员可列出账号');
    const supers = superList.json.data.filter((u) => u.role === 'super_admin');
    check(supers.length === 1, `只能有一个超级管理员 (实际 ${supers.length})`);

    // 新建管理员: 固定 role=admin, 返回一次性临时密码
    const created = await api('POST', A('/api/admin/users'), {
      token: superToken,
      body: { username: 'e2e_newbie', display_name: '新管理员' },
    });
    check(created.status === 200 && created.json.data.user.role === 'admin', '超管创建管理员 (role 固定 admin)');
    check(typeof created.json.data.temp_password === 'string' && created.json.data.temp_password.length >= 8, '创建返回一次性临时密码');
    check(created.json.data.must_change_password === true, '新账号标记为必须改密');
    const dup = await api('POST', A('/api/admin/users'), { token: superToken, body: { username: 'e2e_newbie' } });
    check(dup.status === 409, '重复用户名 -> 409');
    const badName = await api('POST', A('/api/admin/users'), { token: superToken, body: { username: 'Bad Name' } });
    check(badName.status === 400, '非法用户名 -> 400');

    // 客户端不能自封超管
    const escalated = await api('POST', A('/api/admin/users'), {
      token: superToken,
      body: { username: 'e2e_escalate', role: 'super_admin', token_version: 99 },
    });
    check(escalated.status === 200 && escalated.json.data.user.role === 'admin', '客户端提交的 role/token_version 被忽略');
    const superCount = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data.filter((u) => u.role === 'super_admin').length;
    check(superCount === 1, '仍然只有 1 个超级管理员');

    // 超级管理员不能被停用
    const superId = supers[0].id;
    const disableSuper = await api('PATCH', A(`/api/admin/users/${superId}/status`), { token: superToken, body: { enabled: false } });
    check(disableSuper.status === 403, '不能停用超级管理员');
  }

  step('账号停用 / 重新启用 / 强制退出: 旧 Token 立即失效');
  {
    const newbieId = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data.find((u) => u.username === 'e2e_newbie').id;
    const tempPw = 'E2E-Newbie#2026';
    // 超管重置密码 -> 拿到一次性临时密码(登录后必须改密)
    const reset = await api('POST', A(`/api/admin/users/${newbieId}/reset-password`), { token: superToken });
    const loginNewbie = await login('e2e_newbie', reset.json.data.temp_password);
    check(loginNewbie.status === 200 && loginNewbie.json.data.user.must_change_password === true, '临时密码登录: must_change_password=true');
    const newbieToken = loginNewbie.json.data.token;

    const blocked = await api('GET', A('/api/dashboard'), { token: newbieToken });
    check(blocked.status === 403 && blocked.json.code === 'MUST_CHANGE_PASSWORD', '未改密前调用业务接口 -> 403 MUST_CHANGE_PASSWORD');
    const selfMe = await api('GET', A('/api/auth/me'), { token: newbieToken });
    check(selfMe.status === 200, '未改密前仍可读取自己的身份');

    const weak = await api('POST', A('/api/auth/change-password'), { token: newbieToken, body: { old_password: reset.json.data.temp_password, new_password: '123' } });
    check(weak.status === 400, '新密码过短 -> 400');
    const wrongOld = await api('POST', A('/api/auth/change-password'), { token: newbieToken, body: { old_password: 'nope', new_password: tempPw } });
    check(wrongOld.status === 400, '原密码错误 -> 400');

    const changed = await api('POST', A('/api/auth/change-password'), { token: newbieToken, body: { old_password: reset.json.data.temp_password, new_password: tempPw } });
    check(changed.status === 200 && changed.json.data.re_login === true, '修改密码成功, 要求重新登录');
    const oldStillWorks = await api('GET', A('/api/settings'), { token: newbieToken });
    check(oldStillWorks.status === 401, '改密后旧 Token 立即失效 -> 401');
    const relogin = await login('e2e_newbie', tempPw);
    check(relogin.status === 200 && relogin.json.data.user.must_change_password === false, '新密码可登录且不再要求改密');
    const okToken = relogin.json.data.token;
    const nowOk = await api('GET', A('/api/dashboard'), { token: okToken });
    check(nowOk.status === 200, '改密后可正常访问业务接口');

    // 停用 -> 已登录设备立刻被拒; 重新启用后旧 Token 也不会复活
    await api('PATCH', A(`/api/admin/users/${newbieId}/status`), { token: superToken, body: { enabled: false } });
    const afterDisable = await api('GET', A('/api/settings'), { token: okToken });
    check(afterDisable.status === 401, '停用后旧 Token 下一次请求 -> 401');
    await api('PATCH', A(`/api/admin/users/${newbieId}/status`), { token: superToken, body: { enabled: true } });
    const afterEnable = await api('GET', A('/api/settings'), { token: okToken });
    check(afterEnable.status === 401, '重新启用后旧 Token 仍然无效(必须重新登录)');
    const relogin2 = await login('e2e_newbie', tempPw);
    check(relogin2.status === 200, '重新启用后可重新登录');

    // 强制退出所有设备
    await api('POST', A(`/api/admin/users/${newbieId}/revoke-tokens`), { token: superToken });
    const afterRevoke = await api('GET', A('/api/settings'), { token: relogin2.json.data.token });
    check(afterRevoke.status === 401, '强制退出后 Token -> 401');

    // 普通管理员不能管账号
    const forbidden = await api('POST', A(`/api/admin/users/${newbieId}/revoke-tokens`), { token });
    check(forbidden.status === 403, '普通管理员调用账号管理接口 -> 403');
  }

  step('安全审计: 账号操作留痕');
  {
    const logs = await api('GET', A('/api/admin/security-audit-logs'), { token: superToken });
    const actions = logs.json.data.map((l) => l.action);
    for (const a of ['login', 'create_admin', 'reset_password', 'change_password', 'disable_admin', 'enable_admin', 'revoke_tokens']) {
      check(actions.includes(a), `审计日志包含 ${a}`);
    }
    check(logs.json.data.every((l) => l.actor_username), '每条审计都有操作人用户名');
    const denied = await api('GET', A('/api/admin/security-audit-logs'), { token });
    check(denied.status === 403, '普通管理员看不到安全审计');
  }

  step('账号删除: 仅超管可删 / 超管自身不可删 / 审计留痕 / 旧 Token 失效');
  {
    // 建一个一次性账号, 并让它登录一次(留下 actor 痕迹)
    const created = await api('POST', A('/api/admin/users'), {
      token: superToken,
      body: { username: 'e2e_deleteme', display_name: '待删除账号' },
    });
    check(created.status === 200, '创建待删除账号 e2e_deleteme');
    const delId = created.json.data.user.id;
    const loginDel = await login('e2e_deleteme', created.json.data.temp_password);
    check(loginDel.status === 200, '待删除账号可登录');
    const delToken = loginDel.json.data.token;

    // 权限边界
    const anon = await api('DELETE', A(`/api/admin/users/${delId}`));
    check(anon.status === 401, '匿名删除账号 -> 401');
    const byAdmin = await api('DELETE', A(`/api/admin/users/${delId}`), { token });
    check(byAdmin.status === 403, '普通管理员删除账号 -> 403');
    const stillThere = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data.some((u) => u.id === delId);
    check(stillThere, '被拒后账号仍然存在(未误删)');
    const notFound = await api('DELETE', A('/api/admin/users/999999'), { token: superToken });
    check(notFound.status === 404, '删除不存在的账号 -> 404');

    // 超级管理员不允许删除(避免把自己锁在外面)
    const superId = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data.find((u) => u.role === 'super_admin').id;
    const delSuper = await api('DELETE', A(`/api/admin/users/${superId}`), { token: superToken });
    check(delSuper.status === 403 && /超级管理员/.test(delSuper.json.error || ''), '删除超级管理员 -> 403 且提示明确');
    const superAlive = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data.some((u) => u.id === superId);
    check(superAlive, '超级管理员账号未受影响');

    // 正式删除
    const removed = await api('DELETE', A(`/api/admin/users/${delId}`), { token: superToken });
    check(removed.status === 200 && removed.json.data.deleted === true && removed.json.data.username === 'e2e_deleteme', '超管删除普通管理员 -> 200');
    const afterList = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data;
    check(!afterList.some((u) => u.id === delId), '账号已从列表消失');
    const reloginDeleted = await login('e2e_deleteme', created.json.data.temp_password);
    check(reloginDeleted.status === 401, '已删除账号无法再登录 -> 401');
    const tokenDead = await api('GET', A('/api/settings'), { token: delToken });
    check(tokenDead.status === 401, '被删账号已签发的 Token 立即失效 -> 401');

    // 审计: 删除动作留痕 + 被删账号的历史操作记录仍然可追溯(靠用户名快照)
    const logs = (await api('GET', A('/api/admin/security-audit-logs?limit=200'), { token: superToken })).json.data;
    const delLog = logs.find((l) => l.action === 'delete_user' && Number(l.target_user_id) === Number(delId));
    check(!!delLog, '审计日志包含 delete_user');
    check(delLog && delLog.actor_username === accounts.super.username, '审计记录真实操作人(超管)');
    check(delLog && /e2e_deleteme/.test(delLog.details || ''), '审计 details 含被删账号用户名快照');
    check(logs.some((l) => l.actor_username === 'e2e_deleteme'), '被删账号的历史操作日志仍然保留');
    const deletedStillAbsent = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data.some((u) => u.username === 'e2e_deleteme');
    check(!deletedStillAbsent, '审计读取不会把账号"复活"');
  }

  step('种子数据: 默认设置 / 默认积分规则 / 预算');
  let ruleIds = {};
  {
    const s = await api('GET', A('/api/settings'), { token });
    check(s.json?.data?.week_start_day === '1' && s.json?.data?.reward_week_amount === '6', '默认设置已写入 (week_start_day=1, 周奖6)');
    const o = await api('GET', A('/api/options'), { token });
    if (o.json?.data?.rules?.length !== 5 || o.json?.data?.members?.length !== 0) {
      console.log('    [debug] options 原始返回:', JSON.stringify(o.json).slice(0, 500));
    }
    check(o.json?.data?.rules?.length === 5, '默认 5 条积分规则已种子化');
    check(Array.isArray(o.json?.data?.members) && o.json?.data?.members.length === 0, '初始无成员');
    const b = await api('GET', A('/api/budget'), { token });
    const budget = b.json?.data;
    check(budget && budget.total === 120 && budget.paid === 0, '赛季预算 12 周合计 120 元 (6×12+12×3+12)');
    globalThis.__options = o.json?.data; // 保留: now.week_start 等
  }

  step('成员管理: 增 / 重名409 / 改 / 删 / 列表');
  const members = {};
  {
    for (const [key, nick, tag] of [
      ['alpha', 'E2E-Alpha', '#AAAA'],
      ['beta', 'E2E-Beta', '#BBBB'],
      ['gamma', 'E2E-Gamma', '#CCCC'],
      ['delta', 'E2E-Delta', '#DDDD'],
    ]) {
      const r = await api('POST', A('/api/members'), { token, body: { nickname: nick, tag } });
      check(r.status === 200 && r.json?.data?.id > 0, `创建成员 ${nick}`);
      members[key] = r.json.data;
    }
    const dup = await api('POST', A('/api/members'), { token, body: { nickname: 'E2E-Alpha' } });
    check(dup.status === 409, '重名成员 -> 409');
    const up = await api('PUT', A(`/api/members/${members.gamma.id}`), { token, body: { status: 1, note: '请假中' } });
    check(up.status === 200 && up.json.data.status === 1, '更新成员 (gamma 请假 status=1)');
    check(up.json.data.red_since && up.json.data.red_days === 0, '红牌由服务端记 red_since, 当天 red_days=0');
    // 删除默认改为"归档"(软删除), 需要真删时用 ?purge=1
    const del = await api('DELETE', A(`/api/members/${members.delta.id}`), { token });
    check(del.status === 200 && del.json.data.archived === members.delta.id, '删除默认=归档(返回 archived)');
    const lst0 = await api('GET', A('/api/members'), { token });
    check(!lst0.json.data.some((m) => m.id === members.delta.id), '归档成员不出现在默认列表');
    const lstArch = await api('GET', A('/api/members?include_archived=1'), { token });
    const archivedDelta = lstArch.json.data.find((m) => m.id === members.delta.id);
    check(archivedDelta && archivedDelta.deleted_at && archivedDelta.status === 2, 'include_archived=1 可见归档成员(status=2 + deleted_at)');
    const purge = await api('DELETE', A(`/api/members/${members.delta.id}?purge=1`), { token: superToken });
    check(purge.status === 200 && purge.json.data.purged === true, '?purge=1 才是物理删除(测试清理用)');
    const lst = await api('GET', A('/api/members'), { token });
    check(lst.json.data.length === 3, '成员列表剩 3 人');

    // 录入页/成员选择器直接用 /api/options: 必须带 tag, 否则选人弹层的「游戏标签」永远显示未设置、
    // 按标签搜索也搜不到 (真机上表现为"标签丢了")
    const opt = await api('GET', A('/api/options'), { token });
    const optAlpha = (opt.json.data.members || []).find((m) => m.nickname === 'E2E-Alpha');
    check(!!optAlpha && 'tag' in optAlpha, '/api/options 成员带 tag 字段');
    check(optAlpha && optAlpha.tag === '#AAAA', `/api/options 返回真实标签 (实际 ${optAlpha && optAlpha.tag})`);
    const optAnon = await api('GET', A('/api/options'));
    const anonAlpha = (optAnon.json.data.members || []).find((m) => m.nickname === 'E2E-Alpha');
    check(optAnon.status === 200 && anonAlpha && anonAlpha.tag === '#AAAA', '匿名读 /api/options 也能拿到标签(与公开成员列表口径一致)');
  }

  step('积分规则: 新增 / 停用保护 / 重名409 / 无上限项');
  {
    let r = await api('POST', A('/api/rules'), { token, body: { name: 'E2E-A捐兵', unit: '每100兵力', score_per_unit: 1, weekly_cap: 10 } });
    check(r.status === 200 && r.json.data.id > 0, '新增规则 E2E-A (每单位1分, 周上限10)');
    ruleIds.a = r.json.data.id;
    r = await api('POST', A('/api/rules'), { token, body: { name: 'E2E-B无上限', unit: '次', score_per_unit: 1, weekly_cap: null } });
    ruleIds.b = r.json.data.id;
    check(r.json.data.weekly_cap === null, '新增规则 E2E-B (无周上限)');
    const dup = await api('POST', A('/api/rules'), { token, body: { name: 'E2E-A捐兵' } });
    check(dup.status === 409, '规则重名 -> 409');

    // 停用规则后录入被拒
    let dis = await api('PUT', A(`/api/rules/${ruleIds.a}`), { token, body: { enabled: 0 } });
    check(dis.status === 200 && dis.json.data.enabled === 0, '停用 E2E-A');
    const recBad = await api('POST', A('/api/records'), { token, body: { rule_id: ruleIds.a, quantity: 5, member_ids: [members.alpha.id] } });
    if (!recBad.json?.data) console.log('    [debug] 停用规则录入原始返回:', recBad.status, JSON.stringify(recBad.json ?? recBad.text).slice(0, 300));
    check(recBad.json.data.inserted === 0 && /已停用/.test(recBad.json.data.errors[0] || ''), '向停用规则录入被拒');
    dis = await api('PUT', A(`/api/rules/${ruleIds.a}`), { token, body: { enabled: 1 } });
    check(dis.json.data.enabled === 1, '重新启用 E2E-A');

    // 非法录入参数
    const recNoQty = await api('POST', A('/api/records'), { token, body: { rule_id: ruleIds.a, quantity: 0, member_ids: [members.alpha.id] } });
    check(recNoQty.json.data.inserted === 0 && /大于 0/.test(recNoQty.json.data.errors[0] || ''), '数量<=0 被拒');
    const recNoRule = await api('POST', A('/api/records'), { token, body: { rule_id: 99999, quantity: 5, member_ids: [members.alpha.id] } });
    check(recNoRule.json.data.inserted === 0, '不存在的规则 -> 拒绝(0插入)');

    // 录入页快捷数量(quick_values): 显式配置, 不做单位换算/名称推断
    const qv = await api('POST', A('/api/rules'), {
      token,
      body: { name: 'E2E-快捷数量', unit: '次', score_per_unit: 1, weekly_cap: 20, quick_values: '100,500,1000' },
    });
    check(
      qv.status === 200 && Array.isArray(qv.json.data.quick_values) && qv.json.data.quick_values.join(',') === '100,500,1000',
      `新建规则带 quick_values -> 返回数组 (${JSON.stringify(qv.json.data.quick_values)})`
    );
    const qvId = qv.json.data.id;
    const qvUp = await api('PUT', A(`/api/rules/${qvId}`), { token, body: { quick_values: [1, 2, 5, 9, 99] } });
    check(
      qvUp.json.data.quick_values.join(',') === '1,2,5,9',
      `PUT 快捷数量最多保留 4 个 (${JSON.stringify(qvUp.json.data.quick_values)})`
    );
    const qvBad = await api('PUT', A(`/api/rules/${qvId}`), { token, body: { quick_values: 'abc,0,-5' } });
    check(Array.isArray(qvBad.json.data.quick_values) && qvBad.json.data.quick_values.length === 0, '非法/非正数快捷数量被清空');
    // 只改 enabled 时不应丢掉快捷数量(部分更新契约)
    await api('PUT', A(`/api/rules/${qvId}`), { token, body: { quick_values: '10,20' } });
    const qvToggle = await api('PUT', A(`/api/rules/${qvId}`), { token, body: { enabled: false } });
    check(qvToggle.json.data.quick_values.join(',') === '10,20', '只改 enabled 不会清掉快捷数量');
    await api('DELETE', A(`/api/rules/${qvId}`), { token });

    // 录入页拿到的规则(启用中)也带 quick_values 数组
    const optRules = (await api('GET', A('/api/options'), { token })).json.data.rules;
    check(
      optRules.length > 0 && optRules.every((x) => Array.isArray(x.quick_values)),
      'GET /api/options 的规则带 quick_values 数组'
    );
  }

  // 设置页(优化版)实际发出的请求形状: 固定 week_start_day='1' + 两位小数字符串金额;
  // 规则编辑器提交全量字段; 启停提交布尔值; 上限留空提交 null(而不是 0)。
  step('设置页契约: 金额保存 / 预算重算 / 规则编辑器全量字段');
  {
    const save = await api('PUT', A('/api/settings'), {
      token,
      body: {
        week_start_day: '1',
        reward_week_amount: '8.00',
        reward_month_amount: '12.00',
        reward_season_amount: '12.00',
      },
    });
    check(save.status === 200 && save.json.data.reward_week_amount === '8.00', 'PUT /settings 接受两位小数字符串金额');
    check(save.json.data.week_start_day === '1', 'PUT /settings 保持周一起点');
    let budget = await api('GET', A('/api/budget'), { token });
    check(budget.json.data.total === 144, '预算随金额重算 (8×12 + 12×3 + 12 = 144)');

    const back = await api('PUT', A('/api/settings'), {
      token,
      body: { week_start_day: '1', reward_week_amount: '6', reward_month_amount: '12', reward_season_amount: '12' },
    });
    check(back.json.data.reward_week_amount === '6', '还原周奖 6 元');
    budget = await api('GET', A('/api/budget'), { token });
    check(budget.json.data.total === 120, '预算还原为 120 元');

    const badKey = await api('PUT', A('/api/settings'), { token, body: { week_start_day_evil: '1' } });
    check(badKey.status === 400, '设置白名单外字段 -> 400');

    const edit = await api('PUT', A(`/api/rules/${ruleIds.b}`), {
      token,
      body: { name: 'E2E-B无上限', unit: '次', score_per_unit: 2.5, weekly_cap: 12.5 },
    });
    check(
      edit.status === 200 && num(edit.json.data.score_per_unit) === 2.5 && num(edit.json.data.weekly_cap) === 12.5,
      '规则全量编辑 (2.5 分 / 周上限 12.5)'
    );

    const clearCap = await api('PUT', A(`/api/rules/${ruleIds.b}`), {
      token,
      body: { name: 'E2E-B无上限', unit: '次', score_per_unit: 2.5, weekly_cap: null },
    });
    check(clearCap.json.data.weekly_cap === null, '上限留空 -> null (不限)');

    const zeroCap = await api('PUT', A(`/api/rules/${ruleIds.b}`), {
      token,
      body: { name: 'E2E-B无上限', unit: '次', score_per_unit: 2.5, weekly_cap: 0 },
    });
    check(num(zeroCap.json.data.weekly_cap) === 0, '上限 0 合法 (上限为 0 分, 不等于不限)');

    const off = await api('PUT', A(`/api/rules/${ruleIds.b}`), { token, body: { enabled: false } });
    check(off.json.data.enabled === 0, '启停提交布尔 false -> 已停用');
    const on = await api('PUT', A(`/api/rules/${ruleIds.b}`), { token, body: { enabled: true } });
    check(on.json.data.enabled === 1, '启停提交布尔 true -> 已启用');

    // 还原 E2E-B 初始口径 (1 分 / 不限), 后续封顶与结算用例依赖它
    await api('PUT', A(`/api/rules/${ruleIds.b}`), {
      token,
      body: { name: 'E2E-B无上限', unit: '次', score_per_unit: 1, weekly_cap: null },
    });
    const list = await api('GET', A('/api/rules'), { token });
    const b = list.json.data.find((x) => x.id === ruleIds.b);
    check(num(b.score_per_unit) === 1 && b.weekly_cap === null, 'E2E-B 已还原为 1 分 / 不限');
  }

  step('批量录入 (本周) + 本周排行封顶验证');
  let todayWs = '';
  {
    const ins = await api('POST', A('/api/records'), {
      token,
      body: { entries: [{ rule_id: ruleIds.a, quantity: 25, member_ids: [members.alpha.id, members.beta.id], note: 'E2E-本周' }] },
    });
    check(ins.json.data.inserted === 2, '批量录入 2 人成功');
    todayWs = ins.json.data.week_start;
    check(/^\d{4}-\d{2}-\d{2}$/.test(todayWs), `返回本周起始 ${todayWs}`);

    // 25 分 > 周上限 10 -> 排行榜应封顶为 10
    const rank = await api('GET', A(`/api/ranking?type=week&cycle_start=${todayWs}`), { token });
    const rows = rank.json.data.rows;
    const alphaRow = rows.find((x) => x.nickname === 'E2E-Alpha');
    const betaRow = rows.find((x) => x.nickname === 'E2E-Beta');
    check(alphaRow && alphaRow.total === 10, '本周 E2E-Alpha 25分被周上限截断为 10');
    check(betaRow && betaRow.total === 10, '本周 E2E-Beta 25分被周上限截断为 10');
    const recs = await api('GET', A(`/api/records?week_start=${todayWs}`), { token });
    check(recs.json.data.total === 2 && recs.json.data.rows[0].note === 'E2E-本周', '本周流水查询可过滤');

    // 修改流水: 数量 25 -> 7 (分=7, 重新计算)
    const recId = recs.json.data.rows[0].id;
    const upd = await api('PUT', A(`/api/records/${recId}`), { token, body: { quantity: 7, note: 'E2E-改7' } });
    check(num(upd.json.data.score) === 7 && upd.json.data.note === 'E2E-改7', 'PUT 流水: 数量改7 -> 分重算为7');
    // 删除该条, 恢复干净
    const del = await api('DELETE', A(`/api/records/${recId}`), { token });
    check(del.status === 200, 'DELETE 单条流水成功');
  }

  step('历史周/月/赛季数据: 直插 MySQL 验证跨周封顶与周期聚合');
  const weekStarts = ['2024-01-01', '2024-01-08', '2024-01-15', '2024-01-22', '2024-01-29'];
  {
    // 每月/赛季锚点: 2024-01-01(周一) 为 month/season 块起点; 2024-01-29 起为第2个月块
    const ins = async (mid, rid, ws, qty) => {
      await pool.execute(
        'INSERT INTO score_records (member_id, rule_id, quantity, score, week_start, note) VALUES (?, ?, ?, ?, ?, ?)',
        [mid, rid, qty, qty, ws, 'hist']
      );
    };
    // E2E-Alpha: A规则跨周 [12→封10, 5, -, 8, 6], B规则 [3,3,3,3,1]
    await ins(members.alpha.id, ruleIds.a, weekStarts[0], 12);
    await ins(members.alpha.id, ruleIds.a, weekStarts[1], 5);
    await ins(members.alpha.id, ruleIds.a, weekStarts[3], 8);
    await ins(members.alpha.id, ruleIds.a, weekStarts[4], 6);
    await ins(members.alpha.id, ruleIds.b, weekStarts[0], 3);
    await ins(members.alpha.id, ruleIds.b, weekStarts[1], 3);
    await ins(members.alpha.id, ruleIds.b, weekStarts[2], 3);
    await ins(members.alpha.id, ruleIds.b, weekStarts[3], 3);
    await ins(members.alpha.id, ruleIds.b, weekStarts[4], 1);
    // E2E-Beta: A规则 [20→封10, 1, 1, 1], B规则 [2]
    await ins(members.beta.id, ruleIds.a, weekStarts[0], 20);
    await ins(members.beta.id, ruleIds.a, weekStarts[1], 1);
    await ins(members.beta.id, ruleIds.a, weekStarts[2], 1);
    await ins(members.beta.id, ruleIds.a, weekStarts[3], 1);
    await ins(members.beta.id, ruleIds.b, weekStarts[0], 2);
    // E2E-Gamma: A规则 [2] (请假成员仍参与统计)
    await ins(members.gamma.id, ruleIds.a, weekStarts[0], 2);

    const q = async (type, cycle_start) => {
      const r = await api('GET', A(`/api/ranking?type=${type}&cycle_start=${cycle_start}`), { token });
      return r.json.data.rows;
    };

    // 单周 (2024-01-01): Alpha 13 (10+3), Beta 12 (10+2), Gamma 2
    const wk = await q('week', '2024-01-01');
    const byName = (n) => wk.find((x) => x.nickname === n);
    check(byName('E2E-Alpha')?.total === 13 && byName('E2E-Alpha')?.rank === 1, '周排行 W1: Alpha=13 第1 (规则A封顶10+规则B3)');
    check(byName('E2E-Beta')?.total === 12 && byName('E2E-Beta')?.rank === 2, '周排行 W1: Beta=12 第2 (规则A封顶10+规则B2)');
    check(byName('E2E-Gamma')?.total === 2, '周排行 W1: Gamma=2');

    // 月块 (2024-01-01): Alpha A=10+5+0+8=23, B=3+3+3+3=12 -> 35
    const mo = await q('month', '2024-01-01');
    const moA = mo.find((x) => x.nickname === 'E2E-Alpha');
    check(moA?.total === 35 && moA?.breakdown?.[ruleIds.a] === 23, '月排行: Alpha=35 (A封顶逐周后 23 + B 12)');
    check(mo.find((x) => x.nickname === 'E2E-Beta')?.total === 15, '月排行: Beta=15');

    // 赛季块 (2024-01-01, 跨 2 个月块): Alpha 35 + (A6 + B1) = 42
    const se = await q('season', '2024-01-01');
    check(se.find((x) => x.nickname === 'E2E-Alpha')?.total === 42, '赛季排行: Alpha=42 (跨月累计)');

    // 第2个月块 (2024-01-29): 仅 Alpha A6+B1=7
    const mo2 = await q('month', '2024-01-29');
    const mo2A = mo2.find((x) => x.nickname === 'E2E-Alpha');
    check(mo2A?.total === 7 && mo2A?.rank === 1, '第2月块: Alpha=7 第1');

    // 周期列表接口 (应含"当前"周期起点: 来自 options.now)
    const cyc = await api('GET', A('/api/ranking/cycles?type=month&limit=5'), { token });
    const expectedMonthStart = globalThis.__options?.now?.month_start;
    if (!cyc.json.data.cycles.includes(expectedMonthStart)) {
      console.log('    [debug] cycles 返回:', JSON.stringify(cyc.json?.data), '期望含:', expectedMonthStart);
    }
    check(
      cyc.json.data.cycles.length === 5 &&
        expectedMonthStart &&
        cyc.json.data.cycles.includes(expectedMonthStart),
      'month cycles 列表返回最近 5 个块且含当前块'
    );

    // 流水按周期过滤
    const recByCycle = await api('GET', A('/api/records?type=week&cycle_start=2024-01-01'), { token });
    check(recByCycle.json.data.total === 5, '周流水按周期过滤 -> 5 条 (Alpha3+Beta1+Gamma1)');
  }

  step('结算(周): 生成快照+红包 / 幂等 / 列表');
  let rewardId = 0;
  {
    const st = await api('POST', A('/api/settle'), { token, body: { type: 'week', cycle_start: '2024-01-01' } });
    const d = st.json.data;
    check(d.already === false && d.settled === 3, '结算 W1: 快照 3 人 (含请假 Gamma)');
    check(d.winner?.nickname === 'E2E-Alpha' && d.winner?.amount === 6, '周冠军 Alpha, 奖励 6 元');
    const again = await api('POST', A('/api/settle'), { token, body: { type: 'week', cycle_start: '2024-01-01' } });
    check(again.json.data.already === true, '重复结算 -> already:true (幂等)');
    const lst = await api('GET', A('/api/settle/list?type=week'), { token });
    const rec = lst.json.data.find((x) => x.cycle_start === '2024-01-01');
    check(rec && rec.member_count === 3 && rec.winner?.nickname === 'E2E-Alpha', '结算列表含 W1 及冠军');
  }

  step('红包: 发放记录 / 标记已发 / 已发撤销保护 / 撤销结算');
  {
    const rw = await api('GET', A('/api/settle/rewards?type=week'), { token });
    check(rw.json.data.length === 1 && num(rw.json.data[0].amount) === 6 && rw.json.data[0].paid === 0, '红包记录: 1 条未发放 6 元');
    rewardId = rw.json.data[0].id;
    const mark = await api('PUT', A(`/api/settle/rewards/${rewardId}`), { token, body: { paid: 1 } });
    check(mark.json.data.paid === 1, '标记红包已发放');
    const b1 = await api('GET', A('/api/budget'), { token });
    check(b1.json.data.paid === 6, '预算已发放 = 6');
    const undoPaid = await api('DELETE', A('/api/settle/week/2024-01-01'), { token });
    check(undoPaid.status === 409, '已发放周期禁止撤销 -> 409');
    await api('PUT', A(`/api/settle/rewards/${rewardId}`), { token, body: { paid: 0 } });
    const undo = await api('DELETE', A('/api/settle/week/2024-01-01'), { token });
    check(undo.status === 200 && undo.json.data.undone === true, '标记未发放后可撤销结算');
    const lst = await api('GET', A('/api/settle/list?type=week'), { token });
    check(!lst.json.data.find((x) => x.cycle_start === '2024-01-01'), '撤销后结算列表已清空 W1');
    // 重新结算 W1, 让备份快照中包含结算/红包数据 (供恢复往返校验)
    const st2 = await api('POST', A('/api/settle'), { token, body: { type: 'week', cycle_start: '2024-01-01' } });
    check(st2.json.data.already === false && st2.json.data.settled === 3, '重新结算 W1 (作为备份基线)');
  }

  step('CSV 导出: 排行榜 / 明细 / 非法类型');
  {
    const csv = await api('GET', A('/api/export?type=week&cycle_start=2024-01-01&kind=ranking'), { token, raw: true });
    check(csv.status === 200 && /排名,成员,标签,积分/.test(csv.text) && /E2E-Alpha/.test(csv.text), '导出排行榜 CSV 含表头与成员');
    const csvRec = await api('GET', A('/api/export?type=week&cycle_start=2024-01-01&kind=records'), { token, raw: true });
    check(csvRec.status === 200 && /成员,积分项,数量,积分,所属周,备注,录入时间/.test(csvRec.text), '导出明细 CSV 含表头');
    const bad = await api('GET', A('/api/export?type=year&kind=ranking'), { token });
    check(bad.status === 400, '非法周期类型导出 -> 400');
  }

  step('仪表盘字段');
  {
    const d = await api('GET', A('/api/dashboard'), { token });
    const data = d.json.data;
    check(
      data && data.member_count === 3 && data.now?.week_start && typeof data.top3 === 'object',
      '仪表盘返回 成员数/当前周/top3'
    );
  }

  step('备份 → 变更 → 恢复 (往返一致性)');
  let backup = null;
  {
    const b = await api('GET', A('/api/backup'), { token });
    backup = b.json.data;
    const counts = Object.fromEntries(Object.entries(backup.tables).map(([t, rows]) => [t, rows.length]));
    // 历史直插 15 条 + 本周 API 录入剩 1 条 = 16; 结算快照 3 行 + 红包 1 行
    check(
      counts.members === 3 && counts.score_records === 16 && counts.weekly_results === 3 && counts.reward_logs === 1,
      `备份快照: members=3, score_records=16, weekly_results=3, reward_logs=1 (实际 ${JSON.stringify(counts)})`
    );
    // 备份后: 加 1 条本周流水 + 删 1 条历史流水(gamma 在 2024-01-01 的 A 规则记录)
    const extra = await api('POST', A('/api/records'), { token, body: { rule_id: ruleIds.a, quantity: 3, member_ids: [members.alpha.id], note: 'E2E-extra' } });
    check(extra.json.data.inserted === 1, '备份后追加 1 条流水');
    const gammaRec = await api('GET', A(`/api/records?week_start=2024-01-01&member_id=${members.gamma.id}`), { token });
    const victim = gammaRec.json.data.rows[0];
    const delVictim = await api('DELETE', A(`/api/records/${victim.id}`), { token });
    check(delVictim.status === 200, '备份后删除 1 条历史流水');

    const adminRestore = await api('POST', A('/api/restore'), { token, body: { tables: backup.tables } });
    check(adminRestore.status === 403, '普通管理员恢复备份 -> 403 (不可逆操作限超管)');
    const restore = await api('POST', A('/api/restore'), { token: superToken, body: { tables: backup.tables } });
    check(restore.status === 200 && restore.json.data.restored === true, 'POST /api/restore 成功');

    const after = await api('GET', A('/api/backup'), { token });
    const afterCounts = Object.fromEntries(Object.entries(after.json.data.tables).map(([t, rows]) => [t, rows.length]));
    check(
      afterCounts.members === counts.members &&
        afterCounts.score_records === counts.score_records &&
        afterCounts.reward_logs === counts.reward_logs &&
        afterCounts.weekly_results === counts.weekly_results,
      `恢复后各表行数与备份一致 (records=${afterCounts.score_records})`
    );
    // 被删的历史记录回来了; 备份后追加的 E2E-extra 被清除, 本周只剩备份态那 1 条
    const gammaRec2 = await api('GET', A(`/api/records?week_start=2024-01-01&member_id=${members.gamma.id}`), { token });
    check(gammaRec2.json.data.total === 1, '被删历史流水已恢复');
    const todayRecs = await api('GET', A(`/api/records?week_start=${todayWs}`), { token });
    check(
      todayRecs.json.data.total === 1 &&
        todayRecs.json.data.rows.every((x) => x.note !== 'E2E-extra') &&
        todayRecs.json.data.rows.some((x) => x.note === 'E2E-本周'),
      '恢复后本周流水回到备份态 (1 条 E2E-本周, 无 E2E-extra)'
    );
    void backup; void counts; void after; void afterCounts;
  }

  step('规则删除保护 (有流水不能删)');
  {
    const r = await api('DELETE', A(`/api/rules/${ruleIds.a}`), { token });
    check(r.status === 409, '有流水引用的规则禁止删除 -> 409');
  }

  step('成员三态语义: 绿牌/红牌计入, 离开排除');
  {
    const before = await api('GET', A('/api/dashboard'), { token });
    const n0 = before.json.data.member_count;
    const mk = async (nick, status) => {
      const r = await api('POST', A('/api/members'), { token, body: { nickname: nick, status } });
      check(r.status === 200 && r.json.data.status === status, `创建成员 ${nick} (status=${status})`);
      return r.json.data;
    };
    const green = await mk('E2E-绿牌', 0);
    const red = await mk('E2E-红牌', 1);
    const left = await mk('E2E-离开', 2);

    const after = await api('GET', A('/api/dashboard'), { token });
    check(after.json.data.member_count === n0 + 2, `离开成员不计入部落人数 (${n0} -> ${after.json.data.member_count})`);

    const opt = await api('GET', A('/api/options'), { token });
    const ids = opt.json.data.members.map((m) => m.id);
    check(ids.includes(green.id) && ids.includes(red.id) && !ids.includes(left.id), '录入候选含绿牌/红牌, 不含离开');

    const list = await api('GET', A('/api/members'), { token });
    check(list.json.data.some((m) => m.id === left.id && m.status === 2), '离开成员仍保留在成员列表(不物理删除)');
    check(list.json.data.filter((m) => m.status === 2).length === 1, '成员列表可区分三态(离开 1 人)');
  }

  step('访客只读: 可读不可写 (写操作一律 403)');
  {
    const vLogin = await api('POST', A('/api/auth/viewer-login'), { body: { password: viewerPassword } });
    check(vLogin.status === 200 && vLogin.json?.data?.role === 'viewer', '访客口令登录 -> role=viewer');
    const vToken = vLogin.json.data.token;

    const me = await api('GET', A('/api/auth/me'), { token: vToken });
    check(
      me.status === 200 && me.json?.data?.role === 'viewer' && me.json.data.can_write === false,
      'GET /api/auth/me 返回只读身份 (can_write=false)'
    );

    for (const p of ['/api/dashboard', '/api/members', '/api/ranking?type=week', '/api/records?limit=5', '/api/options']) {
      const r = await api('GET', A(p), { token: vToken });
      check(r.status === 200, `访客可读 ${p} -> 200`);
    }

    for (const p of ['/api/settings', '/api/budget', '/api/backup']) {
      const r = await api('GET', A(p), { token: vToken });
      check(r.status === 403, `访客读管理信息 ${p} -> 403`);
    }
    const exp = await api('GET', A('/api/export?kind=ranking'), { token: vToken, raw: true });
    check(exp.status === 403, '访客导出 CSV -> 403');

    const writes = [
      ['POST', '/api/records', { rule_id: ruleIds.a, quantity: 1, member_ids: [members.alpha.id] }],
      ['POST', '/api/members', { nickname: 'E2E-访客尝试' }],
      ['PUT', `/api/members/${members.alpha.id}`, { nickname: 'E2E-访客改名' }],
      ['DELETE', `/api/members/${members.alpha.id}`, undefined],
      ['POST', '/api/rules', { name: 'E2E-访客规则' }],
      ['PUT', `/api/rules/${ruleIds.a}`, { enabled: 0 }],
      ['POST', '/api/settle', { type: 'week', cycle_start: '2024-01-01' }],
      ['PUT', '/api/settings', { reward_week_amount: '99' }],
      ['POST', '/api/restore', { tables: {} }],
    ];
    for (const [m, p, body] of writes) {
      const r = await api(m, A(p), { token: vToken, body });
      check(r.status === 403, `访客 ${m} ${p} -> 403`);
    }

    // 写操作被拒后数据必须没变
    const alpha = await api('GET', A('/api/members'), { token });
    check(alpha.json.data.some((m) => m.id === members.alpha.id && m.nickname === 'E2E-Alpha'), '被拒的写操作未改动数据');

    // 访客看不到内部备注
    const vMembers = await api('GET', A('/api/members'), { token: vToken });
    check(
      Array.isArray(vMembers.json.data) && vMembers.json.data.length > 0 && vMembers.json.data.every((m) => m.note === undefined),
      '访客成员列表不含内部备注 note'
    );
    const aMembers = await api('GET', A('/api/members'), { token });
    check(aMembers.json.data.every((m) => typeof m.note === 'string'), '管理员成员列表仍含备注');

    // 对照组: 管理员仍可写
    const adminWrite = await api('POST', A('/api/records'), {
      token,
      body: { rule_id: ruleIds.b, quantity: 2, member_ids: [members.alpha.id], note: 'E2E-admin-对照' },
    });
    check(adminWrite.json?.data?.inserted === 1, '同一时刻管理员仍可录入 (对照)');
  }

  step('录入预览: 显示"实际新增积分"(按周上限截断)');
  {
    // ruleIds.a = 周上限 10 / 单价 1
    const cur = await api('GET', A(`/api/ranking?type=week&rule_id=${ruleIds.a}`), { token });
    const a0 = (cur.json.data.rows.find((x) => x.member_id === members.alpha.id) || {}).total || 0;

    const pv = await api('POST', A('/api/records/preview'), {
      token,
      body: { rule_id: ruleIds.a, quantity: 4, member_ids: [members.alpha.id] },
    });
    const rowPv = (pv.json.data.members || []).find((m) => m.member_id === members.alpha.id);
    check(pv.status === 200 && !!rowPv, 'POST /api/records/preview -> 200 且含成员明细');
    check(rowPv.before === a0, `预览 before 等于当前有效分 (${a0})`);
    check(rowPv.delta === Math.min(a0 + 4, 10) - Math.min(a0, 10), '预览 delta 按周上限计算');
    check(pv.json.data.total_delta === rowPv.delta, '预览 total_delta = 逐人 delta 之和');

    const over = await api('POST', A('/api/records/preview'), {
      token,
      body: { rule_id: ruleIds.a, quantity: 100, member_ids: [members.alpha.id] },
    });
    const rowOver = over.json.data.members[0];
    check(rowOver.delta === Math.max(0, 10 - a0) && rowOver.capped === true, '超上限: delta 被截断且标记 capped');

    const badRule = await api('POST', A('/api/records/preview'), { token, body: { rule_id: 999999, quantity: 1, member_ids: [members.alpha.id] } });
    check(badRule.json.data.total_delta === 0 && badRule.json.data.errors.length === 1, '预览对无效规则返回 errors 且 delta=0');
  }

  step('幂等: 同一 client_token 重复提交不重复记账 + 撤销本批');
  {
    const tok = `E2E-TOKEN-${Date.now()}`;
    const body = {
      rule_id: ruleIds.b,
      quantity: 3,
      member_ids: [members.alpha.id, members.beta.id],
      client_token: tok,
      note: 'E2E-幂等',
    };
    const r1 = await api('POST', A('/api/records'), { token, body });
    check(r1.json.data.inserted === 2 && r1.json.data.duplicated === 0, '首次提交 inserted=2');
    const r2 = await api('POST', A('/api/records'), { token, body });
    check(r2.json.data.inserted === 0 && r2.json.data.duplicated === 2, '重复提交 inserted=0 duplicated=2 (幂等)');
    const cnt = await api('GET', A(`/api/records?client_token=${tok}`), { token });
    check(cnt.json.data.total === 2, '该批次实际只写入 2 条');

    const rev = await api('POST', A(`/api/records/batches/${tok}/revoke`), { token, body: {} });
    check(rev.status === 200 && rev.json.data.revoked === 2, '撤销本批 -> revoked=2');
    const cnt2 = await api('GET', A(`/api/records?client_token=${tok}`), { token });
    check(cnt2.json.data.total === 0, '撤销后批次记录归零');
    const rev2 = await api('POST', A(`/api/records/batches/${tok}/revoke`), { token, body: {} });
    check(rev2.status === 404, '重复撤销 -> 404');
  }

  step('粘贴星数名单: 一次提交多组不同数量 (entries) + 整批撤销 + 重导恢复');
  {
    // 录入页「粘贴星数名单」的提交形态: 每个星数组一条 entry, 共用一个 client_token。
    // 这里用 A 规则(单价1/周上限10) 覆盖"每组数量不同 + 封顶"两种关键行为。
    const mk = async (nickname) =>
      (await api('POST', A('/api/members'), { token, body: { nickname, status: 0 } })).json.data.id;
    const p1 = await mk('E2E-星数-15星');
    const p2 = await mk('E2E-星数-6星');
    const p3 = await mk('E2E-星数-2星');
    const p4 = await mk('E2E-星数-新成员'); // 只用于"批次号复用"校验, 不进首批名单

    const starToken = `E2E-STARS-${Date.now()}`;
    const entries = [
      { rule_id: ruleIds.a, quantity: 100, member_ids: [p1], note: 'E2E-粘贴星数' },
      { rule_id: ruleIds.a, quantity: 3, member_ids: [p2], note: 'E2E-粘贴星数' },
      { rule_id: ruleIds.a, quantity: 2, member_ids: [p3], note: 'E2E-粘贴星数' },
    ];

    const pv = await api('POST', A('/api/records/preview'), { token, body: { entries } });
    check(pv.status === 200 && pv.json.data.members.length === 3, '预览接受 entries: 返回每人明细');
    check(pv.json.data.total_delta === 15, `预览 10(封顶) + 3 + 2 = 15 (实际 ${pv.json.data.total_delta})`);
    const pvCapped = pv.json.data.members.find((m) => m.member_id === p1);
    check(pvCapped && pvCapped.capped === true && pvCapped.delta === 10, '预览: 超上限那组按周上限截断并标 capped');
    check(pv.json.data.members.every((m) => m.before === 0), '预览返回 before, 可用于"本周已录过"提醒');

    const weekStart = pv.json.data.week_start;
    const ins = await api('POST', A('/api/records'), { token, body: { entries, client_token: starToken } });
    check(ins.status === 200 && ins.json.data.inserted === 3 && ins.json.data.duplicated === 0, '一次提交 3 组 -> inserted=3');
    check(ins.json.data.total_delta === 15, `服务端 total_delta=15 (实际 ${ins.json.data.total_delta})`);

    const recs = await api('GET', A(`/api/records?client_token=${starToken}`), { token });
    check(recs.json.data.total === 3, '3 组共 3 条流水');
    check(
      new Set(recs.json.data.rows.map((r) => r.client_token)).size === 1,
      '3 组共用同一个 client_token(可整批撤销)'
    );
    const byMember = new Map(recs.json.data.rows.map((r) => [r.member_id, r]));
    check(Number(byMember.get(p2).quantity) === 3 && Number(byMember.get(p3).quantity) === 2, '每人按自己那组的数量记账, 不是同一个数量');
    check(Number(byMember.get(p1).score) === 100, '原始分仍按 100 记录(封顶只影响统计)');

    const rank = await api('GET', A(`/api/ranking?type=week&cycle_start=${weekStart}&rule_id=${ruleIds.a}`), { token });
    const t1 = (rank.json.data.rows.find((x) => x.member_id === p1) || {}).total;
    const t2 = (rank.json.data.rows.find((x) => x.member_id === p2) || {}).total;
    check(t1 === 10 && t2 === 3, `榜单: 超限组 10 分 / 3 星组 3 分 (实际 ${t1} / ${t2})`);

    // 同一份名单重复点提交: 同 token + 同成员 -> 幂等
    const again = await api('POST', A('/api/records'), { token, body: { entries, client_token: starToken } });
    check(
      again.json.data.inserted === 0 && again.json.data.duplicated === 3 && again.json.data.total_delta === 0,
      '整份名单重复提交 -> 幂等, 不重复记分'
    );
    const afterAgain = await api('GET', A(`/api/records?client_token=${starToken}`), { token });
    check(afterAgain.json.data.total === 3, '重复提交后仍是 3 条');
    check(
      Number(afterAgain.json.data.rows.find((r) => r.member_id === p2).quantity) === 3,
      '重复提交不会改写已入账的数量'
    );

    // 同 token 但出现了本批次没录过的成员 -> 409(否则"撤销本批"会误删)
    const widened = await api('POST', A('/api/records'), {
      token,
      body: {
        entries: [
          ...entries,
          { rule_id: ruleIds.a, quantity: 1, member_ids: [p4], note: 'E2E-粘贴星数' },
        ],
        client_token: starToken,
      },
    });
    check(widened.status === 409, '同一批次号多了新成员 -> 409');

    const rev = await api('POST', A(`/api/records/batches/${starToken}/revoke`), { token, body: {} });
    check(rev.status === 200 && rev.json.data.revoked === 3, '撤销本批 -> 3 组一起回滚');
    check((await api('GET', A(`/api/records?client_token=${starToken}`), { token })).json.data.total === 0, '撤销后批次归零');

    // 录错了怎么办: 撤销本批 -> 用新批次号重新导入(每颗星 3 分 -> 改成 2 分)
    const fixEntries = entries.map((e) => ({ ...e, quantity: e.quantity === 100 ? 8 : e.quantity }));
    const fix = await api('POST', A('/api/records'), {
      token,
      body: { entries: fixEntries, client_token: `E2E-STARS-FIX-${Date.now()}` },
    });
    check(fix.status === 200 && fix.json.data.inserted === 3, '撤销后重新导入 -> 正常写入 3 条');
    const rank2 = await api('GET', A(`/api/ranking?type=week&cycle_start=${weekStart}&rule_id=${ruleIds.a}`), { token });
    const f1 = (rank2.json.data.rows.find((x) => x.member_id === p1) || {}).total;
    check(f1 === 8, `修正后的 8 颗星生效 (实际 ${f1})`);

    await api('POST', A(`/api/records/batches/${fix.json.data.client_token}/revoke`), { token, body: {} });
    for (const id of [p1, p2, p3, p4]) {
      await api('DELETE', A(`/api/members/${id}?purge=1`), { token: superToken });
    }
    const gone = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data
      .filter((m) => /^E2E-星数-/.test(m.nickname)).length;
    check(gone === 0, '粘贴星数测试成员与流水已清理');
  }

  step('服务端校验: total_delta / 离开成员拒绝 / 批次号复用拒绝');
  {
    // 1) 保存接口返回服务端计算的"最终新增积分"
    const tokA = `E2E-DELTA-${Date.now()}`;
    const r1 = await api('POST', A('/api/records'), {
      token,
      body: { rule_id: ruleIds.b, quantity: 3, member_ids: [members.alpha.id], client_token: tokA },
    });
    check(r1.json.data.inserted === 1 && r1.json.data.total_delta === 3, `POST /records 返回 total_delta=3 (实际 ${r1.json.data.total_delta})`);

    const r2 = await api('POST', A('/api/records'), {
      token,
      body: { rule_id: ruleIds.b, quantity: 3, member_ids: [members.alpha.id], client_token: tokA },
    });
    check(r2.json.data.duplicated === 1 && r2.json.data.total_delta === 0, '同批次重复提交: duplicated=1 且 total_delta=0(不重复计分)');

    // 2) 同一 client_token 换内容 -> 409(否则"撤销本批"会误删)
    const r3 = await api('POST', A('/api/records'), {
      token,
      body: { rule_id: ruleIds.b, quantity: 3, member_ids: [members.beta.id], client_token: tokA },
    });
    check(r3.status === 409, '同一批次号换了成员 -> 409');
    await api('POST', A(`/api/records/batches/${tokA}/revoke`), { token, body: {} });

    // 3) 离开成员: 不写入, 但同批其它成员正常录入并返回原因
    const left = await api('POST', A('/api/members'), { token, body: { nickname: 'E2E-校验离开', status: 2 } });
    const leftId = left.json.data.id;
    const tokB = `E2E-LEFT-${Date.now()}`;
    const r4 = await api('POST', A('/api/records'), {
      token,
      body: { rule_id: ruleIds.b, quantity: 2, member_ids: [members.alpha.id, leftId], client_token: tokB },
    });
    check(r4.json.data.inserted === 1, '含离开成员的批次: 只录入在部落成员');
    check((r4.json.data.errors || []).some((x) => /已离开部落/.test(x)), '返回「已离开部落」提示');
    const r5 = await api('POST', A('/api/records/preview'), {
      token,
      body: { rule_id: ruleIds.b, quantity: 2, member_ids: [leftId] },
    });
    check(r5.json.data.total_delta === 0 && (r5.json.data.errors || []).some((x) => /已离开部落/.test(x)), '预览同样拒绝离开成员');

    await api('POST', A(`/api/records/batches/${tokB}/revoke`), { token, body: {} });
    await api('DELETE', A(`/api/members/${leftId}?purge=1`), { token: superToken });
  }

  step('撤销保护: 已结算周不允许撤销录入');
  {
    const tok = `E2E-SETTLED-${Date.now()}`;
    await pool.execute(
      'INSERT INTO score_records (member_id, rule_id, quantity, score, week_start, note, client_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [members.alpha.id, ruleIds.b, 1, 1, '2024-01-01', 'E2E-已结算周', tok]
    );
    const rev = await api('POST', A(`/api/records/batches/${tok}/revoke`), { token, body: {} });
    check(rev.status === 409, '已结算周的批次撤销 -> 409');
    await pool.execute('DELETE FROM score_records WHERE client_token = ?', [tok]);
  }

  step('排行榜: 分项榜(rule_id) + 离开成员开关');
  {
    const boards = await api('GET', A('/api/ranking/boards'), { token });
    check(Array.isArray(boards.json.data) && boards.json.data.length >= 2, 'GET /api/ranking/boards 返回启用规则(分项榜来源)');

    const aBoard = await api('GET', A(`/api/ranking?type=week&cycle_start=2024-01-01&rule_id=${ruleIds.a}`), { token });
    const rowsA = aBoard.json.data.rows;
    check(rowsA.find((x) => x.nickname === 'E2E-Alpha').total === 10, '分项榜A(封顶10): Alpha=10');
    check(rowsA.find((x) => x.nickname === 'E2E-Beta').total === 10, '分项榜A(封顶10): Beta=10');
    const bBoard = await api('GET', A(`/api/ranking?type=week&cycle_start=2024-01-01&rule_id=${ruleIds.b}`), { token });
    check(bBoard.json.data.rows.find((x) => x.nickname === 'E2E-Alpha').total === 3, '分项榜B(无上限): Alpha=3');

    const withoutLeft = await api('GET', A('/api/ranking?type=week&cycle_start=2024-01-01'), { token });
    check(!withoutLeft.json.data.rows.some((r) => r.status === 2), '默认排行不包含离开成员');
    check(withoutLeft.json.data.include_left === false, '默认 include_left=false');
    const withLeft = await api('GET', A('/api/ranking?type=week&cycle_start=2024-01-01&include_left=1'), { token });
    const leftRows = withLeft.json.data.rows.filter((r) => r.status === 2);
    check(leftRows.length >= 1, 'include_left=1 时包含离开成员');
    check(leftRows.every((r) => r.rank > 0), '离开成员仍有名次(仅展示)');
  }

  step('批量导入: 预览分类 + 导入 + 离开成员恢复');
  {
    const text = [
      'E2E-批量新成员,#BATCH01,一次导入',
      'E2E-批量二号,#BATCH02',
      'E2E-Beta,#ZZZZ', // 同名(在部落)但标签新 -> conflict
      'E2E-离开', // 同名(离开) -> restore
      `${'超'.repeat(70)},#LONG`, // 昵称超长 -> 错误行
    ].join('\n');

    const pv = await api('POST', A('/api/members/batch/preview'), { token, body: { text } });
    const c = pv.json.data.counts;
    check(pv.status === 200 && c.add === 2, `预览: 新增 2 项 (${JSON.stringify(c)})`);
    check(c.conflict === 1, '预览: 同名(在部落) 判为待确认');
    check(c.restore === 1, '预览: 离开成员判为可恢复');
    check(pv.json.data.errors.length === 1, '预览: 超长昵称报 1 条错误');
    check(pv.json.data.in_tribe_after === pv.json.data.in_tribe_before + 3, '预览: 导入后在部落人数 = 原 + 新增2 + 恢复1');

    // 新导入页依赖的字段契约: 五类计数齐全 / 标签已补 '#' 且大写 / 备注字段名是 note / 错误文案自带行号
    check(
      ['add', 'restore', 'exists', 'conflict', 'invalid'].every((k) => typeof c[k] === 'number'),
      '预览: counts 五类计数齐全 (add/restore/exists/conflict/invalid)'
    );
    const firstAdd = pv.json.data.add[0];
    check(/^#[A-Z0-9]+$/.test(firstAdd.tag), `预览: 新增项 tag 已补 '#' 并大写 (${firstAdd.tag})`);
    check(firstAdd.note === '一次导入', '预览: 备注字段名为 note 且内容正确 (页面展示 member.note)');
    check(/^第 \d+ 行: /.test(pv.json.data.errors[0]), `预览: 错误文案自带行号 (${pv.json.data.errors[0]})`);

    // 粘贴内容内重复 -> invalid, 并进入 errors(页面用 errors.length 展示错误/重复数)
    const pvDup = await api('POST', A('/api/members/batch/preview'), {
      token,
      body: { text: 'E2E-重复甲,#DUP01\nE2E-重复乙,#DUP01' },
    });
    check(pvDup.json.data.counts.invalid === 1, '预览: 粘贴内重复标签判为 invalid');
    check(
      pvDup.json.data.errors.some((e) => /粘贴内容内重复/.test(e)),
      '预览: invalid 行同时进入 errors(带行号)'
    );

    // 标签去重: 用 E2E-Alpha 的标签插一行 -> exists
    const pv2 = await api('POST', A('/api/members/batch/preview'), { token, body: { text: '随便谁,#AAAA' } });
    check(pv2.json.data.counts.exists === 1, '预览: 已存在标签判为 exists(不新建)');

    const imp = await api('POST', A('/api/members/batch'), { token, body: { text } });
    check(imp.status === 200 && imp.json.data.added === 2, '导入: 新增 2 人');
    check(imp.json.data.restored === 1, '导入: 恢复 1 名离开成员');

    // 重复提交同一份名单不会重复建人(导入页重试/连点安全): 标签命中 exists, 同名命中 conflict
    const beforeCount = (await api('GET', A('/api/members'), { token })).json.data.length;
    const again = await api('POST', A('/api/members/batch'), { token, body: { text } });
    const afterCount = (await api('GET', A('/api/members'), { token })).json.data.length;
    check(again.json.data.added === 0 && again.json.data.restored === 0, '重复导入同一名单: 新增 0 / 恢复 0');
    check(again.json.data.skipped_exists === 2, '重复导入: 2 条按标签命中 exists 跳过');
    check(afterCount === beforeCount, '重复导入后成员总数不变(不会重复建人)');

    const opt = await api('GET', A('/api/options'), { token });
    const names = opt.json.data.members.map((m) => m.nickname);
    check(names.includes('E2E-批量新成员') && names.includes('E2E-离开'), '导入后两人都出现在录入候选(离开已恢复为在部落)');

    // 清理: 删除新增的两人, 把 E2E-离开 改回离开
    const all = await api('GET', A('/api/members'), { token });
    for (const nick of ['E2E-批量新成员', 'E2E-批量二号']) {
      const hit = all.json.data.find((m) => m.nickname === nick);
      if (hit) await api('DELETE', A(`/api/members/${hit.id}?purge=1`), { token: superToken });
    }
    const leftOne = (await api('GET', A('/api/members'), { token })).json.data.find((m) => m.nickname === 'E2E-离开');
    if (leftOne) await api('PUT', A(`/api/members/${leftOne.id}`), { token, body: { status: 2 } });
    check(true, '导入测试数据已清理');
  }

  // 识图导入格式(名称,大本营,牌子,繁荣度) + 重名时牌子变化/资料变化的快速修改
  step('识图导入: 大本营/繁荣度 + 牌子变化快速修改 + 繁荣度排行');
  {
    const OCR = ['E2E-识图甲,14,绿,63', 'E2E-识图乙,15,绿,62', 'E2E-识图丙,13,红,41'].join('\n');

    const pv1 = await api('POST', A('/api/members/batch/preview'), { token, body: { text: OCR } });
    const c1 = pv1.json.data.counts;
    check(pv1.status === 200 && c1.add === 3, `识图格式: 3 人全部识别为新增 (${JSON.stringify(c1)})`);
    const r1 = pv1.json.data.add.find((r) => r.nickname === 'E2E-识图甲');
    check(r1.town_hall === 14 && r1.prosperity === 63 && r1.status === 0, '识图格式: 大本营/繁荣度/牌子都解析出来了');
    const r3 = pv1.json.data.add.find((r) => r.nickname === 'E2E-识图丙');
    check(r3.status === 1, '识图格式: 红牌会被记为红牌');

    const imp1 = await api('POST', A('/api/members/batch'), { token, body: { text: OCR } });
    check(imp1.json.data.added === 3, '识图格式: 导入 3 人');

    const list1 = (await api('GET', A('/api/members'), { token })).json.data;
    const m甲 = list1.find((m) => m.nickname === 'E2E-识图甲');
    const m丙 = list1.find((m) => m.nickname === 'E2E-识图丙');
    check(m甲 && m甲.town_hall === 14 && m甲.prosperity === 63, '入库: 大本营 14 / 繁荣度 63');
    check(m丙 && m丙.status === 1 && m丙.red_since, '入库: 红牌成员自动带 red_since(当天)');

    // 繁荣度排行: 有繁荣度的排前面且降序, 没有的排最后
    const idx = (nick) => list1.findIndex((m) => m.nickname === nick);
    check(
      idx('E2E-识图甲') < idx('E2E-识图乙') && idx('E2E-识图乙') < idx('E2E-识图丙'),
      '成员列表默认按繁荣度降序 (63 > 62 > 41)'
    );
    const withProsperity = list1.filter((m) => m.prosperity != null).length;
    check(
      withProsperity === 3 && list1.slice(-1)[0].prosperity == null,
      '没有繁荣度的成员排在最后'
    );

    // 同一份名单再导一次: 完全一致 -> 不算变化, 幂等
    const pvSame = await api('POST', A('/api/members/batch/preview'), { token, body: { text: OCR } });
    check(
      pvSame.json.data.counts.status_change === 0 && pvSame.json.data.counts.profile_change === 0,
      '同一份名单再预览: 没有任何变化'
    );
    const impSame = await api('POST', A('/api/members/batch'), { token, body: { text: OCR } });
    check(impSame.json.data.status_changed === 0 && impSame.json.data.profile_changed === 0, '重复导入不会重复改数据(幂等)');

    // 改牌子 + 改大本营/繁荣度
    const OCR2 = ['E2E-识图甲,16,红,70', 'E2E-识图乙,15,绿,60', 'E2E-识图丙,13,绿,55'].join('\n');
    const pv2 = await api('POST', A('/api/members/batch/preview'), { token, body: { text: OCR2 } });
    const c2 = pv2.json.data.counts;
    check(c2.status_change === 2, `重名+牌子变化 -> status_change 2 (${JSON.stringify(c2)})`);
    check(c2.profile_change === 1, '重名+只有资料变化 -> profile_change 1');
    check(c2.add === 0 && c2.restore === 0, '重名不会被当成新增');
    check(
      pv2.json.data.status_change_detail.to_red === 1 && pv2.json.data.status_change_detail.to_green === 1,
      '牌子变化明细: 绿→红 1 人 / 红→绿 1 人'
    );
    const sc甲 = pv2.json.data.status_change.find((r) => r.nickname === 'E2E-识图甲');
    check(
      sc甲.from_status === 0 && sc甲.to_status === 1 && sc甲.from_town_hall === 14 && sc甲.town_hall === 16,
      '牌子变化行带 from/to 牌子与大本营旧值(页面直接展示"绿→红 / 14→16")'
    );

    // 只勾"资料变化"、不勾"牌子变化": 牌子不动, 大本营/繁荣度照改
    const impPartial = await api('POST', A('/api/members/batch'), {
      token,
      body: { text: OCR2, apply: { status_change: false, profile_change: true } },
    });
    check(impPartial.json.data.status_changed === 0, '未勾选牌子变化 -> 一个人都没改牌子');
    check(impPartial.json.data.profile_changed >= 2, '勾选了资料变化 -> 大本营/繁荣度照改');
    const mid = (await api('GET', A('/api/members'), { token })).json.data;
    const mid甲 = mid.find((m) => m.nickname === 'E2E-识图甲');
    check(mid甲.status === 0 && mid甲.town_hall === 16 && mid甲.prosperity === 70, '牌子仍是绿牌, 大本营/繁荣度已更新');

    // 再勾上牌子变化 -> 快速修改生效
    const impFull = await api('POST', A('/api/members/batch'), {
      token,
      body: { text: OCR2, apply: { status_change: true, profile_change: true } },
    });
    check(impFull.json.data.status_changed === 2, '勾选牌子变化 -> 改 2 人');
    const after = (await api('GET', A('/api/members'), { token })).json.data;
    const a甲 = after.find((m) => m.nickname === 'E2E-识图甲');
    const a丙 = after.find((m) => m.nickname === 'E2E-识图丙');
    check(a甲.status === 1 && !!a甲.red_since, '绿→红: 状态变红牌并由服务端记 red_since');
    check(a丙.status === 0 && !a丙.red_since, '红→绿: 状态变绿牌并结束红牌计时');

    // 审计留痕(谁改的牌子)
    // 注意: 本机 mysql2 + MySQL 8.0.23 下 pool.execute 带结果集会挂起(见 src/db.js 注释),
    //       所以这里的 SELECT 必须用文本协议 pool.query(与其它步骤一致)。
    const [logRows] = await pool.query(
      "SELECT COUNT(*) AS c FROM member_status_logs WHERE reason = '批量导入改牌子'"
    );
    check(Number(logRows[0].c) >= 2, `牌子变化写审计日志 (${Number(logRows[0].c)} 条「批量导入改牌子」)`);

    // 校验: 大本营只要求正整数、繁荣度只要求非负整数 —— 都不设上限
    const bigTh = await api('POST', A('/api/members/batch/preview'), { token, body: { text: 'E2E-识图甲,20,绿,60' } });
    check(
      !bigTh.json.data.errors.length && bigTh.json.data.add.length + bigTh.json.data.profile_change.length + bigTh.json.data.status_change.length === 1,
      '大本营 20(超过旧上限) -> 正常识别, 不做上限校验'
    );
    // 20 万远超旧代码上限(1000000 之外还超过 SMALLINT 65535), 用来证明列已放宽到 INT UNSIGNED
    const bigPr = await api('POST', A('/api/members/batch/preview'), { token, body: { text: 'E2E-识图甲,14,绿,200000' } });
    check(!bigPr.json.data.errors.length, '繁荣度 200000(超过旧 1000000 以内的 SMALLINT 上限) -> 正常识别');
    const badTh = await api('POST', A('/api/members/batch/preview'), { token, body: { text: 'E2E-识图甲,0,绿,60' } });
    check(badTh.json.data.errors.some((e) => /大本营等级/.test(e)), '大本营 0 -> 报错(需是不小于 1 的整数)');
    const badPr = await api('POST', A('/api/members/batch/preview'), { token, body: { text: 'E2E-识图甲,14,绿,abc' } });
    check(badPr.json.data.errors.some((e) => /繁荣度/.test(e)), '繁荣度非数字 -> 报错');
    const negPr = await api('POST', A('/api/members/batch/preview'), { token, body: { text: 'E2E-识图甲,14,绿,-5' } });
    check(negPr.json.data.errors.some((e) => /繁荣度/.test(e)), '繁荣度 -5 -> 报错(需是不小于 0 的整数)');

    // 手工编辑成员也能改大本营/繁荣度
    const editRes = await api('PUT', A(`/api/members/${a丙.id}`), { token, body: { town_hall: 15, prosperity: 44 } });
    check(editRes.status === 200 && editRes.json.data.town_hall === 15 && editRes.json.data.prosperity === 44, 'PUT /api/members/:id 可改大本营/繁荣度');
    const editBig = await api('PUT', A(`/api/members/${a丙.id}`), { token, body: { town_hall: 99 } });
    check(editBig.status === 200 && editBig.json.data.town_hall === 99, 'PUT 大本营 99 也允许(无上限)');
    const editBigPr = await api('PUT', A(`/api/members/${a丙.id}`), { token, body: { prosperity: 12345678 } });
    check(
      editBigPr.status === 200 && Number(editBigPr.json.data.prosperity) === 12345678,
      'PUT 繁荣度 12345678 也允许(列已是 INT UNSIGNED, 无上限)'
    );
    const editBad = await api('PUT', A(`/api/members/${a丙.id}`), { token, body: { town_hall: 0 } });
    check(editBad.status === 400, '大本营 0 -> 400');
    const editBadPr = await api('PUT', A(`/api/members/${a丙.id}`), { token, body: { prosperity: -1 } });
    check(editBadPr.status === 400, '繁荣度 -1 -> 400');

    // 清理
    for (const nick of ['E2E-识图甲', 'E2E-识图乙', 'E2E-识图丙']) {
      const hit = (await api('GET', A('/api/members'), { token })).json.data.find((m) => m.nickname === nick);
      if (hit) await api('DELETE', A(`/api/members/${hit.id}?purge=1`), { token: superToken });
    }
    check(true, '识图导入测试数据已清理');
  }

  // 成员管理页(重新设计版)的后端契约:
  //   红牌计时由服务端算 / 归档=软删除 / 批量操作整批成功或失败 + 幂等 / 50 人上限保护
  step('成员管理: 红牌计时 / 归档保留历史 / 批量幂等 / 50 人上限');
  {
    const ymdAgo = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    };
    const membersNow = async () => (await api('GET', A('/api/members'), { token })).json.data;
    const baseline = (await membersNow()).filter((m) => m.status !== 2).map((m) => m.nickname).sort();

    // 1) 红牌计时: 新建红牌=今天; 补录 10 天前; 改名/备注不重置 (验收 1)
    const red = await api('POST', A('/api/members'), { token, body: { nickname: 'E2E-红牌计时', tag: '#REDTIME', status: 1 } });
    const redId = red.json.data.id;
    check(red.json.data.red_days === 0 && red.json.data.red_since === ymdAgo(0), '新建红牌成员: red_since=今天, red_days=0');
    const back = await api('PUT', A(`/api/members/${redId}/red-since`), { token, body: { red_since: ymdAgo(10), reason: 'E2E 补录' } });
    check(back.status === 200 && back.json.data.red_days === 10, '补录 10 天前 -> red_days=10');
    const renamed = await api('PUT', A(`/api/members/${redId}`), { token, body: { nickname: 'E2E-红牌计时改', note: '改名不改计时' } });
    check(renamed.json.data.red_days === 10 && renamed.json.data.red_since === ymdAgo(10), '改昵称/备注后红牌天数不变');
    check(renamed.json.data.note === '改名不改计时', '普通保存不会碰 red_since');
    const badFuture = await api('PUT', A(`/api/members/${redId}/red-since`), { token, body: { red_since: ymdAgo(-1) } });
    check(badFuture.status === 400, '补录未来日期 -> 400');
    const badFmt = await api('PUT', A(`/api/members/${redId}/red-since`), { token, body: { red_since: '2026/07/01' } });
    check(badFmt.status === 400, '补录非法日期格式 -> 400');

    // 2) 15 天边界: 第 15 天不算超期, 第 16 天算 (验收 3; 前后端同一规则 red_days > 15)
    await api('PUT', A(`/api/members/${redId}/red-since`), { token, body: { red_since: ymdAgo(15) } });
    let cur = (await membersNow()).find((m) => m.id === redId);
    check(cur.red_days === 15, '挂红牌第 15 天: red_days=15 (不超期)');
    await api('PUT', A(`/api/members/${redId}/red-since`), { token, body: { red_since: ymdAgo(16) } });
    cur = (await membersNow()).find((m) => m.id === redId);
    check(cur.red_days === 16, '挂红牌第 16 天: red_days=16 (进入超期提醒)');

    // 3) 红牌 -> 绿牌 -> 红牌: 重新计时 (验收 2)
    await api('PUT', A(`/api/members/${redId}`), { token, body: { status: 0 } });
    cur = (await membersNow()).find((m) => m.id === redId);
    check(cur.red_days === null && cur.red_since === null, '转绿牌: 结束本次红牌计时');
    await api('PUT', A(`/api/members/${redId}`), { token, body: { status: 1 } });
    cur = (await membersNow()).find((m) => m.id === redId);
    check(cur.red_days === 0 && cur.red_since === ymdAgo(0), '再次转红牌: 开始新一轮计时');

    // 4) 历史红牌没有开始时间 -> red_days=null, 不编造 0 天 (验收 4)
    const [legacyIns] = await pool.execute(
      'INSERT INTO members (nickname, tag, status, red_since) VALUES (?, ?, 1, NULL)',
      ['E2E-历史红牌', '#LEGACY']
    );
    const legacyId = legacyIns.insertId;
    cur = (await membersNow()).find((m) => m.id === legacyId);
    check(cur.red_days === null && cur.red_since === null, '历史红牌无开始时间: red_days=null (待补录)');
    // 归档前先造一条历史流水, 后面验证"归档不删历史"
    const legacyTok = `E2E-LEGACY-${Date.now()}`;
    await pool.execute(
      'INSERT INTO score_records (member_id, rule_id, quantity, score, week_start, note, client_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [legacyId, ruleIds.b, 4, 4, '2024-01-01', 'E2E-归档前流水', legacyTok]
    );

    // 5) 批量改状态只影响选中成员 (验收 5 的服务端侧)
    const tok1 = `E2E-BATCH-${Date.now()}-1`;
    const b1 = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: tok1, operation: 'update', member_ids: [legacyId], changes: { status: 0 } },
    });
    check(b1.status === 200 && b1.json.data.affected === 1 && b1.json.data.duplicated === false, '批量设为绿牌: affected=1');
    cur = (await membersNow()).find((m) => m.id === legacyId);
    check(cur.status === 0 && cur.red_since === null, '只改了选中的成员');
    check((await membersNow()).find((m) => m.id === redId).red_days === 0, '未选中的成员未被改动');

    // 6) 幂等: 同 token 同内容 -> 原结果; 同 token 不同内容 -> 409 (验收 7)
    const b1again = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: tok1, operation: 'update', member_ids: [legacyId], changes: { status: 0 } },
    });
    check(b1again.status === 200 && b1again.json.data.duplicated === true && b1again.json.data.affected === 1, '重试原批次: duplicated=true 且不重复执行');
    const b1conflict = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: tok1, operation: 'update', member_ids: [legacyId], changes: { status: 1 } },
    });
    check(b1conflict.status === 409, '同批次号换了内容 -> 409');

    // 7) 批量追加备注: 连点/重试不重复追加 (验收 6)
    const beforeNote = (await membersNow()).find((m) => m.id === legacyId).note;
    const tok2 = `E2E-BATCH-${Date.now()}-2`;
    const noteBody = { client_token: tok2, operation: 'update', member_ids: [legacyId], changes: { append_note: '本周已联系' } };
    const n1 = await api('POST', A('/api/members/batch-action'), { token, body: noteBody });
    check(n1.json.data.affected === 1, '批量追加备注成功');
    const n2 = await api('POST', A('/api/members/batch-action'), { token, body: noteBody });
    check(n2.json.data.duplicated === true, '重复提交同一批次: 不重复追加');
    const afterNote = (await membersNow()).find((m) => m.id === legacyId).note;
    check(afterNote === (beforeNote ? `${beforeNote} | 本周已联系` : '本周已联系'), `备注只追加一次 (${afterNote})`);
    check((afterNote.match(/本周已联系/g) || []).length === 1, '备注中出现次数 = 1');

    // 8) 参数校验
    const noIds = await api('POST', A('/api/members/batch-action'), { token, body: { client_token: 'E2E-NOIDS', operation: 'update', member_ids: [], changes: { status: 0 } } });
    check(noIds.status === 400, 'member_ids 为空 -> 400');
    const badOp = await api('POST', A('/api/members/batch-action'), { token, body: { client_token: 'E2E-BADOP', operation: 'delete', member_ids: [redId] } });
    check(badOp.status === 400, '非法 operation -> 400');
    const noToken = await api('POST', A('/api/members/batch-action'), { token, body: { operation: 'archive', member_ids: [redId] } });
    check(noToken.status === 400, '缺少 client_token -> 400');
    const tooMany = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: 'E2E-TOOMANY', operation: 'update', member_ids: Array.from({ length: 201 }, (_, i) => i + 1), changes: { status: 0 } },
    });
    check(tooMany.status === 400, '单批超过 200 人 -> 400');

    // 9) 归档: 默认列表/录入候选/排行都不再出现, 但历史流水仍在 (验收 9)
    const arcTok = `E2E-ARCHIVE-${Date.now()}`;
    const arc = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: arcTok, operation: 'archive', member_ids: [legacyId] },
    });
    check(arc.json.data.affected === 1, '批量归档 affected=1');
    const arcAgain = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: arcTok, operation: 'archive', member_ids: [legacyId] },
    });
    check(arcAgain.json.data.duplicated === true, '归档批次重试返回原结果');
    check(!(await membersNow()).some((m) => m.id === legacyId), '归档成员不在默认列表');
    const archRow = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data.find((m) => m.id === legacyId);
    check(archRow.status === 2 && !!archRow.deleted_at && archRow.red_since === null, '归档成员: status=2 + deleted_at + 结束红牌计时');
    const optIds = (await api('GET', A('/api/options'), { token })).json.data.members.map((m) => m.id);
    check(!optIds.includes(legacyId), '归档成员不在录入候选');
    const rank = await api('GET', A('/api/ranking?type=week&cycle_start=2024-01-01&include_left=1'), { token });
    check(!rank.json.data.rows.some((r) => r.member_id === legacyId || r.id === legacyId), '归档成员不出现在排行榜(含离开也不出现)');
    const [recRows] = await pool.query('SELECT COUNT(*) AS c FROM score_records WHERE member_id = ?', [legacyId]);
    check(Number(recRows[0].c) === 1, '归档后历史积分流水仍在库中');
    const csv = await api('GET', A('/api/export?type=week&cycle_start=2024-01-01&kind=records'), { token, raw: true });
    check(csv.status === 200 && csv.text.includes('E2E-历史红牌'), '归档成员的历史流水仍可导出 CSV');
    const recArch = await api('POST', A('/api/records'), { token, body: { rule_id: ruleIds.b, quantity: 1, member_ids: [legacyId] } });
    check((recArch.json.data.errors || []).some((x) => /已归档/.test(x)), '归档成员不能录入(提示已归档)');
    const delArc = await api('DELETE', A(`/api/members/${legacyId}`), { token });
    check(delArc.status === 200 && delArc.json.data.already_archived === true, '归档接口对已归档成员幂等');
    // 归档 -> 重新激活(批量转红牌): 清空 deleted_at 并重新计时
    const react = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: `E2E-REACT-${Date.now()}`, operation: 'update', member_ids: [legacyId], changes: { status: 1 } },
    });
    check(react.status === 200, '归档成员可被重新激活');
    const reactRow = (await membersNow()).find((m) => m.id === legacyId);
    check(reactRow && reactRow.deleted_at === null && reactRow.red_days === 0, '重新激活后 deleted_at 清空并重新计时');

    // 10) 审计日志
    const [logRows] = await pool.query('SELECT COUNT(*) AS c FROM member_status_logs WHERE member_id = ?', [legacyId]);
    check(Number(logRows[0].c) >= 3, `状态/红牌变更写入审计日志 (${Number(logRows[0].c)} 条)`);

    // 11) 50 人上限: 49 人在部落时批量恢复 2 人 -> 整批拒绝 (验收 8)
    const inTribeNow = (await api('GET', A('/api/dashboard'), { token })).json.data.member_count;
    const need = 49 - inTribeNow;
    if (need > 0) {
      const values = [];
      const params = [];
      for (let i = 0; i < need; i += 1) {
        values.push('(?, \'\', 0, NULL)');
        params.push(`E2E-FILL-${String(i).padStart(3, '0')}`);
      }
      await pool.execute(`INSERT INTO members (nickname, tag, status, red_since) VALUES ${values.join(',')}`, params);
    }
    const filled = (await membersNow()).filter((m) => m.status !== 2).length;
    check(filled === 49, `构造 49 人在部落 (实际 ${filled})`);
    const over1 = await api('POST', A('/api/members'), { token, body: { nickname: 'E2E-超限甲', status: 2 } });
    const over2 = await api('POST', A('/api/members'), { token, body: { nickname: 'E2E-超限乙', status: 2 } });
    const overTok = `E2E-OVER-${Date.now()}`;
    const over = await api('POST', A('/api/members/batch-action'), {
      token,
      body: { client_token: overTok, operation: 'update', member_ids: [over1.json.data.id, over2.json.data.id], changes: { status: 0 } },
    });
    check(over.status === 409, '在部落 49 人时批量恢复 2 人 -> 整批拒绝(409)');
    check(over.json.error && /50/.test(over.json.error), `拒绝原因说明 50 人上限 (${over.json.error})`);
    check((await membersNow()).filter((m) => m.status !== 2).length === 49, '整批拒绝后没有任何成员被激活(不写一半)');
    // 49 -> 50 恰好等于上限, 允许
    const oneOk = await api('PUT', A(`/api/members/${over1.json.data.id}`), { token, body: { status: 0 } });
    check(oneOk.status === 200, '49 -> 50 人允许(恰好在上限内)');
    // 50 -> 51 单人同样拒绝
    const oneOver = await api('PUT', A(`/api/members/${over2.json.data.id}`), { token, body: { status: 0 } });
    check(oneOver.status === 409, '单人转绿牌同样受 50 人上限保护');

    // 12) 访客不能通过批量接口改成员 (验收 10) + 访客列表不含备注
    const vLogin = await api('POST', A('/api/auth/viewer-login'), { body: { password: viewerPassword } });
    const vToken = vLogin.json.data.token;
    const vBatch = await api('POST', A('/api/members/batch-action'), {
      token: vToken,
      body: { client_token: 'E2E-VIEWER-BATCH', operation: 'archive', member_ids: [redId] },
    });
    check(vBatch.status === 403, '访客调用批量接口 -> 403');
    const vDel = await api('DELETE', A(`/api/members/${redId}`), { token: vToken });
    check(vDel.status === 403, '访客删除成员 -> 403');
    const vRow = (await api('GET', A('/api/members'), { token: vToken })).json.data.find((m) => m.id === redId);
    check(vRow && vRow.note === undefined && vRow.status === 1, '访客可见状态但不含内部备注');

    // 清理: 真删本步骤造的所有成员(含填充成员), 状态回到步骤前
    const cleanupList = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data;
    for (const m of cleanupList.filter((x) => /^E2E-(红牌计时|红牌计时改|历史红牌|FILL-|超限)/.test(x.nickname))) {
      await api('DELETE', A(`/api/members/${m.id}?purge=1`), { token: superToken });
    }
    const finalNames = (await membersNow()).filter((m) => m.status !== 2).map((m) => m.nickname).sort();
    check(JSON.stringify(finalNames) === JSON.stringify(baseline), `成员状态回到步骤前 (${finalNames.join(',')})`);
  }

  step('官方 API 同步: 预览差异(只读) / 勾选应用 / 幂等 / 审计');
  {
    // 未配置部落标签时给出明确提示
    const st0 = await api('GET', A('/api/coc/status'), { token });
    check(st0.status === 200 && st0.json.data.configured === true, 'GET /api/coc/status 已配置 token');
    check(st0.json.data.clan_tag === '', '初始未配置部落标签');

    const noTag = await api('POST', A('/api/coc/preview'), { token, body: {} });
    check(noTag.status === 400 && /部落标签/.test(noTag.json.error), '未配置部落标签 -> 400 且提示明确');

    // 配置部落标签(走设置白名单)
    const setTag = await api('PUT', A('/api/settings'), { token, body: { coc_clan_tag: '#2G9JCRQ9Y' } });
    check(setTag.status === 200 && setTag.json.data.coc_clan_tag === '#2G9JCRQ9Y', 'PUT /settings 保存部落标签');

    // 预览: 桩里 E2E-Alpha 已在本地(绿牌, 桩给 warPreference=in -> 无变化), E2E-新面孔 是新的(桩给 out -> 红牌)
    const pv = await api('POST', A('/api/coc/preview'), { token, body: {} });
    if (pv.status !== 200) console.log('    [debug] preview 原始返回:', pv.status, JSON.stringify(pv.json ?? pv.text).slice(0, 400));
    check(pv.status === 200, 'POST /api/coc/preview -> 200');
    const d = pv.json.data;
    check(d.clan.name === 'E2E 测试部落' && d.clan.level === 7, `部落信息来自官方 API (${d.clan.name})`);
    check(d.counts.api_members === 2, '官方名单 2 人');
    check(d.counts.new_members === 1, `识别出 1 名新成员 (${d.counts.new_members})`);
    const alpha = d.members.find((m) => m.api.name === 'E2E-Alpha');
    const newbie = d.members.find((m) => m.api.name === 'E2E-新面孔');
    check(alpha && alpha.matched_by, `已在库成员按 ${alpha.matched_by} 匹配上`);
    check(alpha.war_preference === 'in' && alpha.target_status === 0, 'warPreference=in -> 绿牌(0)');
    check(newbie && newbie.war_preference === 'out' && newbie.target_status === 1, 'warPreference=out -> 红牌(1)');
    check(newbie.actions.some((a) => a.type === 'add' && a.status === 1), '新成员建议动作带红牌状态');
    check(d.war.state === 'inWar' && d.war.members.length === 1, '当前部落战参战名单(含出手/星数)');
    check(d.war.members[0].three_stars === 1, '三星次数统计正确');

    // 预览不写库
    const before = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data.length;
    await api('POST', A('/api/coc/preview'), { token, body: {} });
    const after = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data.length;
    check(before === after, '预览不写库(成员数不变)');

    // 应用: 只应用"新增新面孔"这一条
    const addAction = newbie.actions.find((a) => a.type === 'add');
    const ap = await api('POST', A('/api/coc/apply'), {
      token,
      body: { actions: [addAction], batch_id: 'E2E-COC-ADD' },
    });
    check(ap.status === 200 && ap.json.data.applied_count === 1, '应用 1 条新增动作');
    const added = (await api('GET', A('/api/members'), { token })).json.data.find((m) => m.nickname === 'E2E-新面孔');
    check(added && added.status === 1 && added.tag === '#E2EBBB2', '新成员已入库: 红牌 + 游戏标签');
    check(!!added.red_since, '红牌成员自动带 red_since');

    // 幂等: 同一条再应用一次 -> 跳过
    const again = await api('POST', A('/api/coc/apply'), { token, body: { actions: [addAction], batch_id: 'E2E-COC-ADD-2' } });
    check(again.status === 200 && again.json.data.applied_count === 0 && again.json.data.skipped_count === 1, '重复应用同一条 -> 跳过');

    // 状态变更: 把已入库的 E2E-Alpha 改成红牌(模拟游戏里改战意), 再同步改回
    await api('PUT', A(`/api/members/${members.alpha.id}`), { token, body: { status: 1 } });
    cocStub.state.pref['#E2EAAA1'] = 'out';
    const pv2 = await api('POST', A('/api/coc/preview'), { token, body: { no_cache: true } });
    const stAction = (pv2.json.data.members.find((m) => m.api.name === 'E2E-Alpha').actions || []).find((a) => a.type === 'status');
    check(!stAction, '游戏内与本地一致时不给状态动作(桩也是 out)');
    cocStub.state.pref['#E2EAAA1'] = 'in';
    const pv3 = await api('POST', A('/api/coc/preview'), { token, body: { no_cache: true } });
    const stAction2 = (pv3.json.data.members.find((m) => m.api.name === 'E2E-Alpha').actions || []).find((a) => a.type === 'status');
    check(!!stAction2 && stAction2.to === 0, '游戏内战意改回 in -> 建议动作: 改回绿牌');
    const ap2 = await api('POST', A('/api/coc/apply'), { token, body: { actions: [stAction2], batch_id: 'E2E-COC-STATUS' } });
    check(ap2.json.data.applied_count === 1, '应用状态变更');
    const alphaRow = (await api('GET', A('/api/members'), { token })).json.data.find((m) => m.id === members.alpha.id);
    check(alphaRow.status === 0, '成员状态已同步为绿牌');

    // 离开: 桩里去掉一个成员 -> 预览给出 leave 建议
    const keep = cocStub.state.members.filter((m) => m.name !== 'E2E-新面孔');
    cocStub.state.members = keep;
    const pv4 = await api('POST', A('/api/coc/preview'), { token, body: { no_cache: true } });
    const leave = pv4.json.data.leaves.find((l) => l.nickname === 'E2E-新面孔');
    check(!!leave, '官方名单里消失 -> 建议记为离开');
    const ap3 = await api('POST', A('/api/coc/apply'), { token, body: { actions: [leave], batch_id: 'E2E-COC-LEAVE' } });
    check(ap3.json.data.applied_count === 1, '应用离开动作');
    const leftRow = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data.find((m) => m.nickname === 'E2E-新面孔');
    check(leftRow.status === 2 && leftRow.deleted_at === null, '离开 = status 2 且未归档(历史保留)');

    // 审计: 同步动作带真实操作人 + 批次号
    const [logs] = await pool.query(
      "SELECT actor_username, actor_role, batch_id, reason FROM member_status_logs WHERE reason LIKE '游戏内同步%' ORDER BY id"
    );
    check(logs.length >= 3, `同步动作写入审计 (${logs.length} 条)`);
    check(logs.every((l) => l.actor_username === accounts.admin.username), '审计记录真实操作人');
    check(logs.some((l) => l.batch_id === 'E2E-COC-ADD'), '审计带同步批次号');

    // 权限: 匿名/访客都不能碰
    const g1 = await api('POST', A('/api/coc/preview'), { body: {} });
    check(g1.status === 401, '匿名调用同步预览 -> 401');
    const v1 = await api('POST', A('/api/coc/preview'), { token: viewerToken, body: {} });
    check(v1.status === 403, '访客调用同步预览 -> 403');
    const g2 = await api('GET', A('/api/coc/status'));
    check(g2.status === 401, '匿名读同步状态 -> 401');

    // 官方 API 报错时透出可读原因
    cocStub.state.failNext = true;
    const boom = await api('POST', A('/api/coc/preview'), { token, body: { no_cache: true } });
    check(boom.status >= 400 && /官方 API/.test(boom.json.error || ''), `官方 API 异常时提示可读 (${boom.json.error})`);

    // ---- 按玩家标签导入(只读查询) ----
    const lk = await api('POST', A('/api/coc/lookup'), {
      token,
      body: { text: '#E2EAAA1\n#E2EOUT1 #E2EOUT2 泥头车出击', no_cache: true },
    });
    check(lk.status === 200, `POST /api/coc/lookup -> 200`);
    const L = lk.json.data;
    check(L.counts.requested === 3 && L.counts.ok === 3, `按标签查到 3 名玩家 (ok=${L.counts.ok})`);
    check(L.invalid.length === 0, '中文备注不会被误当成标签');
    const alphaLk = L.items.find((i) => i.tag === '#E2EAAA1');
    check(alphaLk.in_clan === true && alphaLk.local && alphaLk.local.nickname === 'E2E-Alpha', '标签查询命中本部落成员并匹配本地库');
    check(alphaLk.action === null && alphaLk.local.status_text === '绿牌', '本地与游戏一致 -> 无建议动作');
    const out1 = L.items.find((i) => i.tag === '#E2EOUT1');
    check(out1.in_clan === false && out1.local === null && out1.action && out1.action.type === 'add' && out1.action.status === 0, '不在本部落的玩家也能查到 -> 建议新增(绿牌)');
    const out2 = L.items.find((i) => i.tag === '#E2EOUT2');
    check(out2.action && out2.action.status === 1 && out2.clan_name === '别的部落', '带 # 的标签即使不在官方字符集内也按宽松规则识别');

    // 本地已有该标签但状态不同 -> 建议"改状态"而不是"新增"
    cocStub.state.pref['#E2EAAA1'] = 'out';
    const lk2 = await api('POST', A('/api/coc/lookup'), { token, body: { tags: ['#E2EAAA1'], no_cache: true } });
    const a2 = lk2.json.data.items[0];
    check(a2.action && a2.action.type === 'status' && a2.action.to === 1, '本地已有该标签且状态不同 -> 建议改状态');
    cocStub.state.pref['#E2EAAA1'] = 'in';

    // 查不到的标签: 单条错误, 不影响其它; 空输入与权限
    const lk3 = await api('POST', A('/api/coc/lookup'), { token, body: { tags: ['#E2ENOPE9'], no_cache: true } });
    check(lk3.status === 200 && lk3.json.data.counts.failed === 1 && /notFound/.test(lk3.json.data.items[0].error || ''), '查不到的标签 -> 单条可读错误');
    const lk4 = await api('POST', A('/api/coc/lookup'), { token, body: { text: 'hello world' } });
    check(lk4.status === 400 && /没有识别到/.test(lk4.json.error || ''), '没有有效标签 -> 400 且提示明确');
    const lk5 = await api('POST', A('/api/coc/lookup'), { body: { text: '#E2EAAA1' } });
    check(lk5.status === 401, '匿名按标签查询 -> 401');
    const lk6 = await api('POST', A('/api/coc/lookup'), { token: viewerToken, body: { text: '#E2EAAA1' } });
    check(lk6.status === 403, '访客按标签查询 -> 403');

    // ---- 自动新增(auto_add): 只自动新增成员, 状态变更仍要人工勾选 ----
    cocStub.state.members = [
      { tag: '#E2EAAA1', name: 'E2E-Alpha', role: 'leader', townHallLevel: 12, trophies: 2500, donations: 320, donationsReceived: 40, clanRank: 1 },
      { tag: '#E2ECCC3', name: 'E2E-自动新增', role: 'member', townHallLevel: 10, trophies: 1900, donations: 0, donationsReceived: 0, clanRank: 3 },
    ];
    cocStub.state.pref['#E2EAAA1'] = 'out'; // 制造一条"状态变更", 验证 auto_add 不会顺手改它
    const auto = await api('POST', A('/api/coc/apply'), { token, body: { auto_add: true, batch_id: 'E2E-COC-AUTO' } });
    check(auto.status === 200 && auto.json.data.auto_add_count === 1 && auto.json.data.applied_count === 1, `auto_add 只新增 1 人 (applied=${auto.json.data.applied_count})`);
    const autoRow = (await api('GET', A('/api/members'), { token })).json.data.find((m) => m.nickname === 'E2E-自动新增');
    check(autoRow && autoRow.status === 0 && autoRow.tag === '#E2ECCC3', '自动新增的成员已入库');
    const alphaAuto = (await api('GET', A('/api/members'), { token })).json.data.find((m) => m.id === members.alpha.id);
    check(alphaAuto.status === 0, 'auto_add 不会自动改状态变更(仍需人工勾选)');
    const [autoLogs] = await pool.query("SELECT actor_username, reason FROM member_status_logs WHERE batch_id = 'E2E-COC-AUTO'");
    check(autoLogs.length === 1 && autoLogs[0].actor_username === accounts.admin.username, '自动新增写审计(真实操作人)');
    cocStub.state.pref['#E2EAAA1'] = 'in';
    const auto2 = await api('POST', A('/api/coc/apply'), { token, body: { auto_add: true } });
    check(auto2.status === 400 && /没有需要新增/.test(auto2.json.error || ''), 'auto_add 已无新成员 -> 400 且提示明确');

    // 收拾: 把部落标签与测试成员清掉
    cocStub.state.members = [
      { tag: '#E2EAAA1', name: 'E2E-Alpha', role: 'leader', townHallLevel: 12, trophies: 2500, donations: 320, donationsReceived: 40, clanRank: 1 },
    ];
    await api('PUT', A('/api/settings'), { token, body: { coc_clan_tag: '' } });
    const cleanup = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data.filter((m) => /^E2E-(新面孔|自动新增)$/.test(m.nickname));
    for (const m of cleanup) await api('DELETE', A(`/api/members/${m.id}?purge=1`), { token: superToken });
    await api('PUT', A(`/api/members/${members.alpha.id}`), { token, body: { status: 0 } });
    check(true, '官方同步测试数据已清理');
  }

  step('账号体系: 物理删除限超管 + 操作人审计可追溯');
  {
    // 普通管理员: 归档可以, 物理删除 403
    const m = await api('POST', A('/api/members'), { token, body: { nickname: 'E2E-权限边界', tag: '#SCOPE' } });
    const mid = m.json.data.id;
    const adminPurge = await api('DELETE', A(`/api/members/${mid}?purge=1`), { token });
    check(adminPurge.status === 403, '普通管理员物理删除 -> 403');
    const stillThere = (await api('GET', A('/api/members?include_archived=1'), { token })).json.data.some((x) => x.id === mid);
    check(stillThere, '被拒后成员仍然存在(未误删)');
    const superPurge = await api('DELETE', A(`/api/members/${mid}?purge=1`), { token: superToken });
    check(superPurge.status === 200 && superPurge.json.data.purged === true, '超级管理员物理删除 -> 200');

    // 操作人审计: 新操作记录真实账号, 旧记录不冒充
    const m2 = await api('POST', A('/api/members'), { token, body: { nickname: 'E2E-审计人', tag: '#AUDITOP' } });
    const mid2 = m2.json.data.id;
    await api('PUT', A(`/api/members/${mid2}`), { token, body: { status: 1 } });
    await api('PUT', A(`/api/members/${mid2}`), { token: superToken, body: { status: 0 } });
    const [logRows] = await pool.query(
      'SELECT actor_user_id, actor_username, actor_role, new_status FROM member_status_logs WHERE member_id = ? ORDER BY id',
      [mid2]
    );
    check(logRows.length >= 3, `成员状态变更写入审计 (${logRows.length} 条)`);
    const adminRow = logRows.find((r) => r.actor_username === accounts.admin.username);
    const superRow = logRows.find((r) => r.actor_username === accounts.super.username);
    check(!!adminRow && adminRow.actor_role === 'admin', `管理员操作记录真实用户名 (${accounts.admin.username})`);
    check(!!superRow && superRow.actor_role === 'super_admin', `超管操作记录真实用户名 (${accounts.super.username})`);
    const adminUser = (await api('GET', A('/api/admin/users'), { token: superToken })).json.data.find((u) => u.username === accounts.admin.username);
    check(Number(adminRow.actor_user_id) === Number(adminUser.id), '审计里的操作人 user_id 指向真实账号');
    await api('DELETE', A(`/api/members/${mid2}?purge=1`), { token: superToken });
  }

  step('永久删除(?purge=1): 仅超管 / 级联清空历史 / 审计留存 / 不可重复');
  {
    // ---- 1) 正常流程: 建 -> 录分 -> 归档 -> 超管物理删除 ----
    const nickname = 'E2E-待永久删除';
    const created = await api('POST', A('/api/members'), { token: superToken, body: { nickname, status: 1 } });
    check(created.status === 200, '新建测试成员 -> 200');
    const mid = created.json.data.id;

    const ruleList = (await api('GET', A('/api/rules'), { token: superToken })).json.data;
    const ruleId = (Array.isArray(ruleList) ? ruleList : ruleList.rows)[0].id;
    const rec = await api('POST', A('/api/records'), {
      token: superToken,
      body: { rule_id: ruleId, quantity: 2, member_ids: [mid], note: 'E2E-purge-流水' },
    });
    check(rec.status === 200 && (rec.json.data.errors || []).length === 0, '给测试成员录一次分 -> 200 且无错误');
    const [before] = await pool.query('SELECT COUNT(*) AS c FROM score_records WHERE member_id = ?', [mid]);
    check(Number(before[0].c) === 1, `库里确实有该成员的积分流水 (${Number(before[0].c)} 条)`);

    // 归档(用户的正常流程): 软删除, 历史必须还在
    const arch = await api('DELETE', A(`/api/members/${mid}`), { token: superToken });
    check(arch.status === 200 && arch.json.data.archived === mid, '先归档 -> 200');
    const [archRecs] = await pool.query('SELECT COUNT(*) AS c FROM score_records WHERE member_id = ?', [mid]);
    check(Number(archRecs[0].c) === 1, '归档(软删除)后流水仍在 —— 这正是"归档"与"永久删除"的分界');

    // 权限: 普通管理员不行, 匿名也不行
    const denied = await api('DELETE', A(`/api/members/${mid}?purge=1`), { token });
    check(denied.status === 403 && /超级管理员/.test(denied.json.error || ''), '普通管理员物理删除 -> 403');
    const anon = await api('DELETE', A(`/api/members/${mid}?purge=1`));
    check(anon.status === 401, '匿名物理删除 -> 401');

    // 超管物理删除
    const purged = await api('DELETE', A(`/api/members/${mid}?purge=1`), { token: superToken });
    check(purged.status === 200 && purged.json.data.purged === true, '超管物理删除 -> 200 purged');
    check(
      purged.json.data.removed && purged.json.data.removed.score_records === 1,
      `响应回报连带删掉的明细 (${JSON.stringify(purged.json.data.removed)})`
    );
    const [gone] = await pool.query('SELECT COUNT(*) AS c FROM members WHERE id = ?', [mid]);
    check(Number(gone[0].c) === 0, '成员行已从库里消失');
    const [recGone] = await pool.query('SELECT COUNT(*) AS c FROM score_records WHERE member_id = ?', [mid]);
    check(Number(recGone[0].c) === 0, '该成员的积分流水被级联删除(FK ON DELETE CASCADE 真的生效)');
    const [logKept] = await pool.query('SELECT COUNT(*) AS c FROM member_status_logs WHERE member_id = ?', [mid]);
    check(Number(logKept[0].c) > 0, `状态审计日志不受级联影响、仍然保留 (${Number(logKept[0].c)} 条)`);

    // 安全审计: 永久删除必须留痕(记操作人 + 被删成员 + 连带删除的明细)
    const [audit] = await pool.query(
      "SELECT actor_username, action, details FROM security_audit_logs WHERE action = 'purge_member' ORDER BY id DESC LIMIT 1"
    );
    check(audit.length === 1, '永久删除写入 security_audit_logs');
    check(
      audit[0] && audit[0].actor_username === accounts.super.username,
      `审计记录真实操作人 (${audit[0] && audit[0].actor_username})`
    );
    check(
      audit[0] && audit[0].details.includes(nickname) && audit[0].details.includes('流水1'),
      `审计写明被删成员与连带明细 (${audit[0] && audit[0].details})`
    );

    const again = await api('DELETE', A(`/api/members/${mid}?purge=1`), { token: superToken });
    check(again.status === 404, '重复物理删除 -> 404');

    // ---- 2) 后端并不要求"先归档": 把真实行为钉住 ----
    // App 里额外加了"必须先归档"的保险, 那是前端策略, 不是后端限制 —— 别把两者混为一谈。
    const fresh = await api('POST', A('/api/members'), { token: superToken, body: { nickname: 'E2E-直接删除', status: 0 } });
    const mid2 = fresh.json.data.id;
    const direct = await api('DELETE', A(`/api/members/${mid2}?purge=1`), { token: superToken });
    check(
      direct.status === 200 && direct.json.data.purged === true,
      '后端允许直接物理删除未归档的在册成员(所以前端的"必须先归档"是额外保险)'
    );
    const [gone2] = await pool.query('SELECT COUNT(*) AS c FROM members WHERE id = ?', [mid2]);
    check(Number(gone2[0].c) === 0, '未归档成员确实被真删了(不是软删除)');

    // ---- 3) 不存在时 404 先于权限判断 ----
    const goneAdmin = await api('DELETE', A(`/api/members/${mid2}?purge=1`), { token });
    check(goneAdmin.status === 404, '对不存在的成员, 404 先于权限判断(先查存在性, 再查超管)');
  }

  step('转盘: 概率 45% 边界 + 权重抽取(纯函数)');
  {
    const wheel = await import('../src/lib/wheel.js');
    check(wheel.WIN_PROBABILITY === 0.45, '中奖率常量 = 0.45');
    check(wheel.drawReward(() => 0.46) === null, '随机数 0.46 -> 未中奖');
    check(wheel.drawReward(() => 0.45) === null, '边界 0.45(>=) -> 未中奖');
    const win = wheel.drawReward(() => 0.44);
    check(win && typeof win.key === 'string', '随机数 0.44 -> 中奖并返回奖励项');
    const totalWeight = wheel.REWARD_POOL.reduce((a, r) => a + r.weight, 0);
    check(totalWeight === 100, `奖励池权重合计 = 100 (实际 ${totalWeight})`);
    // 权重抽取: 第二个随机数决定具体奖励(0 -> 第一项)
    const seq = [0.4, 0];
    let i = 0;
    const picked = wheel.drawReward(() => seq[i++]);
    check(picked.key === wheel.REWARD_POOL[0].key, '权重抽取: 随机 0 命中奖励池第一项');
    // 排除同款后不会再次抽到被排除项
    const excluded = wheel.pickWeighted(() => 0, { excludeKeys: [wheel.REWARD_POOL[0].key] });
    check(excluded.key !== wheel.REWARD_POOL[0].key, '排除同款后不再命中该项');
  }

  step('转盘: 代抽(win 分支) / 每日一次幂等 / 外观发放 / 离开成员拒绝');
  {
    const st0 = await api('GET', A(`/api/wheel/status?member_id=${members.alpha.id}`), { token });
    check(st0.status === 200 && st0.json.data.can_draw === true, '抽奖前状态: 可抽');
    check(st0.json.data.probability === 0.45 && Array.isArray(st0.json.data.pool), '状态接口返回概率与奖励池');

    const spin = await api('POST', A('/api/wheel/spin'), { token, body: { member_id: members.alpha.id } });
    check(spin.status === 200 && spin.json.data.already === false, '首次抽奖: already=false');
    check(spin.json.data.win === true && spin.json.data.reward.key === 'frame_flame', '首次抽奖: 中奖且奖励为烈焰头像框(测试强制)');
    check(!!spin.json.data.expires_at, '奖励带过期时间(24h)');
    check(spin.json.data.cosmetics.some((c) => c.kind === 'frame' && c.value === 'flame'), '外观已写入 member_cosmetics');

    const spin2 = await api('POST', A('/api/wheel/spin'), { token, body: { member_id: members.alpha.id } });
    check(spin2.json.data.already === true && spin2.json.data.spin.reward_key === 'frame_flame', '重复抽奖: 返回当天原结果(幂等)');

    const st1 = await api('GET', A(`/api/wheel/status?member_id=${members.alpha.id}`), { token });
    check(st1.json.data.can_draw === false && !!st1.json.data.spin, '抽奖后状态: 今日不可再抽');

    const cos = await api('GET', A('/api/wheel/cosmetics'), { token });
    check(cos.json.data.some((c) => c.member_id === members.alpha.id && c.kind === 'frame'), '外观列表接口可返回该成员头像框');

    const leftMember = (await api('GET', A('/api/members'), { token })).json.data.find((m) => m.nickname === 'E2E-离开');
    const spinLeft = await api('POST', A('/api/wheel/spin'), { token, body: { member_id: leftMember.id } });
    check(spinLeft.status === 409, '离开成员抽奖 -> 409');

    // 访客也能领每日奖励(2026-09 放开): 每成员每天一次由 wheel_spins 唯一键保证,
    // 奖励只影响排行榜外观, 所以不需要管理员权限。
    const vLogin = await api('POST', A('/api/auth/viewer-login'), { body: { password: viewerPassword } });
    const spinViewer = await api('POST', A('/api/wheel/spin'), {
      token: vLogin.json.data.token,
      body: { member_id: members.beta.id },
    });
    check(spinViewer.status === 200 && spinViewer.json.data.already === false, '访客(口令登录)代抽 -> 200');

    const spinViewer2 = await api('POST', A('/api/wheel/spin'), {
      token: vLogin.json.data.token,
      body: { member_id: members.beta.id },
    });
    check(spinViewer2.json.data.already === true, '访客重复代抽 -> 幂等返回当天原结果');

    const spinAnon = await api('POST', A('/api/wheel/spin'), { body: { member_id: members.beta.id } });
    check(
      spinAnon.status === 200 && spinAnon.json.data.already === true,
      '未登录访客代抽同一成员 -> 200 且幂等(不会重复发奖)'
    );

    const anonStatus = await api('GET', A(`/api/wheel/status?member_id=${members.beta.id}`));
    check(anonStatus.status === 200 && anonStatus.json.data.can_draw === false, '未登录访客可读抽奖状态且看到已抽');

    const viewerCos = await api('GET', A('/api/wheel/cosmetics'), { token: vLogin.json.data.token });
    check(viewerCos.status === 200, '访客可查看外观(用于榜单展示)');

    // 只放开了转盘, 不能顺带把别的写操作也放开
    const anonWrite = await api('POST', A('/api/members'), { body: { nickname: '借转盘越权' } });
    check(anonWrite.status === 401, '转盘放开不影响其它写操作: 匿名 POST /api/members 仍 401');

    // 清理, 保持用例可重复
    await pool.execute('DELETE FROM wheel_spins WHERE member_id IN (?, ?)', [members.alpha.id, members.beta.id]);
    await pool.execute('DELETE FROM member_cosmetics WHERE member_id IN (?, ?)', [members.alpha.id, members.beta.id]);
  }

  step('登录限流: 连续5次错误后锁 5 分钟 (429)');
  {
    // 限流是按 (IP + 用户名) 计数的, 而成功登录会清空这两个计数。
    // 前面的用例也会有登录失败(例如"被删账号无法登录"), 所以这里先成功登录一次,
    // 把 IP 维度的计数清零, 保证本用例只观察"连续 5 次错误"这一件事。
    const warm = await login(accounts.admin.username, accounts.admin.password);
    check(warm.status === 200, '限流用例前置: 一次成功登录清空计数');

    const seq = [];
    for (let i = 1; i <= 6; i++) {
      const pw = i <= 5 ? `nope-${i}` : accounts.admin.password;
      const r = await api('POST', A('/api/auth/login'), { body: { username: accounts.admin.username, password: pw } });
      seq.push(r.status);
    }
    console.log('    [debug] 连续 6 次登录状态序列:', seq.join(','));
    check(seq[4] === 401, '第5次错误仍 401 (计数达到锁定阈值)');
    check(seq[5] === 429, '正确密码也被限流 -> 429');
  }

  await pool.end();
  return { passed, failed: failures.length, failures };
}
