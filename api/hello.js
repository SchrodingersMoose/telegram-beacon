module.exports = (req, res) => {
  res.status(200).json({ ok: true, route: "hello", time: Date.now() });
};
