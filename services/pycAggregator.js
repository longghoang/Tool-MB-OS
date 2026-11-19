module.exports = function aggregate(list) {
  const map = {};

  for (const { pyc, manday } of list) {
    // Nếu PYC đã tồn tại → BỎ QUA
    if (map[pyc] !== undefined) continue;

    // Chỉ lấy 1 lần duy nhất
    map[pyc] = manday;
  }

  return Object.entries(map).map(([pyc, manday]) => ({
    pyc,
    manday
  }));
};
