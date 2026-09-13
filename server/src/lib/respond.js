export function ok(res, data) {
  res.json({ ok: true, data });
}

export function fail(res, code, error) {
  res.status(code).json({ ok: false, error });
}
