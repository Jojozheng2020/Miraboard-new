import { stocks } from "stock-api";

const code = String(process.argv[2] || "").trim().toUpperCase();
if (!/^(SH|SZ)\d{6}$/.test(code)) {
  process.stderr.write("unsupported stock code\n");
  process.exit(2);
}

try {
  const [stock, klines] = await Promise.all([
    stocks.auto.getStock(code),
    stocks.auto.getKlines(code, { period: "day", count: 66, adjust: "none" }),
  ]);
  if (!stock || !Number.isFinite(stock.now)) {
    throw new Error("stock-api returned no current price");
  }
  process.stdout.write(JSON.stringify({ stock, klines }));
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exit(1);
}
