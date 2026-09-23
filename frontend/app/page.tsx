import { connection } from "next/server";
import { MoneyWorkbench } from "@/app/workbench";
import { loadMoneyData } from "@/lib/money-data";

export default async function Home() {
  await connection();
  const data = await loadMoneyData();
  return <MoneyWorkbench data={data} />;
}
