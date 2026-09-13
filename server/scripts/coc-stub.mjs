// E2E: 启动一个本地"官方 API 桩服务", 让后端把 COC_API_BASE 指向它, 验证同步逻辑
// (本地沙箱连不通 api.clashofclans.com, 因此用桩服务覆盖真实 HTTP 路径)
import http from 'node:http';

export function startCocStub() {
  const state = {
    hits: 0,
    failNext: false,
    clan: {
      tag: '#2G9JCRQ9Y',
      name: 'E2E 测试部落',
      clanLevel: 7,
      members: 2,
      warWins: 12,
      warWinStreak: 2,
    },
    // 官方成员名单(不含战意), 战意只在 /players/{tag} 里
    members: [
      { tag: '#E2EAAA1', name: 'E2E-Alpha', role: 'leader', townHallLevel: 12, trophies: 2500, donations: 320, donationsReceived: 40, clanRank: 1 },
      { tag: '#E2EBBB2', name: 'E2E-新面孔', role: 'member', townHallLevel: 9, trophies: 1800, donations: 10, donationsReceived: 5, clanRank: 2 },
    ],
    pref: {
      '#E2EAAA1': 'in', // 绿牌
      '#E2EBBB2': 'out', // 红牌
    },
    // 不在本部落的玩家资料(按标签导入时用; 官方 /players/{tag} 一样能查到)
    extra: {
      '#E2EOUT1': { tag: '#E2EOUT1', name: 'E2E-外援', townHallLevel: 11, expLevel: 150, trophies: 2100, warPreference: 'in', donations: 5, clan: null },
      '#E2EOUT2': { tag: '#E2EOUT2', name: 'E2E-退役', townHallLevel: 8, expLevel: 90, trophies: 1200, warPreference: 'out', donations: 0, clan: { tag: '#OTHERCLAN', name: '别的部落' } },
    },
    war: {
      state: 'inWar',
      teamSize: 2,
      attacksPerMember: 2,
      clan: {
        members: [
          { tag: '#E2EAAA1', name: 'E2E-Alpha', mapPosition: 1, townHallLevel: 12, attacks: [{ stars: 3 }, { stars: 2 }] },
        ],
      },
    },
  };

  const server = http.createServer((req, res) => {
    state.hits += 1;
    const auth = req.headers.authorization || '';
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!auth.startsWith('Bearer e2e-coc-token')) {
      return send(403, { reason: 'accessDenied', message: 'Invalid authorization' });
    }
    if (state.failNext) {
      state.failNext = false;
      return send(503, { reason: 'serviceUnavailable', message: 'stub 故意失败' });
    }

    const raw = req.url || '';
    const url = decodeURIComponent(raw); // %23 解码成 #, 下面按解码后的路径匹配
    if (url === '/v1/clans/#2G9JCRQ9Y') return send(200, state.clan);
    if (url === '/v1/clans/#2G9JCRQ9Y/members') return send(200, { items: state.members });
    if (url === '/v1/clans/#2G9JCRQ9Y/currentwar') return send(200, state.war);
    const pm = url.match(/^\/v1\/players\/(#[0-9A-Z]+)$/);
    if (pm) {
      const tag = pm[1].toUpperCase();
      const m = state.members.find((x) => x.tag.toUpperCase() === tag);
      if (!m) {
        const extra = state.extra[tag];
        if (!extra) return send(404, { reason: 'notFound' });
        return send(200, { ...extra, tag });
      }
      return send(200, {
        tag: m.tag,
        name: m.name,
        townHallLevel: m.townHallLevel,
        role: m.role,
        warPreference: state.pref[m.tag] || 'in',
        donations: m.donations,
        clanCapitalContributions: 100,
        clan: { tag: '#2G9JCRQ9Y', name: 'E2E 测试部落' },
      });
    }
    send(404, { reason: 'notFound', path: url });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        base: `http://127.0.0.1:${port}/v1`,
        state,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
