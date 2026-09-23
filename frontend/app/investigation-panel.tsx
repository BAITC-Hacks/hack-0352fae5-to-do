"use client";

import { useState } from "react";
import type { Language } from "@/app/workbench";
import type { InvestigationRoute, MoneyInvestigations, TimingStatus } from "@/lib/investigation-data";

const LABELS: Record<Language, Record<TimingStatus, string>> = {
  en: { direct_transfer: "Direct transfer", date_ordered: "Date-ordered", same_day_order_unknown: "Same-day order unknown", structural_only: "Structural connection only" },
  ru: { direct_transfer: "Прямой перевод", date_ordered: "Порядок по датам", same_day_order_unknown: "Порядок внутри дня неизвестен", structural_only: "Только связь в графе" },
};
const DESCRIPTIONS: Record<Language, Record<TimingStatus, string>> = {
  en: {
    direct_transfer: "One observed link. The earliest transfer is shown; this makes no claim about onward movement.",
    date_ordered: "Each next transfer occurs 1–2 calendar days later. Amounts need not match; this does not trace identical funds.",
    same_day_order_unknown: "A sequence exists with 0–2 day gaps, but at least one step shares a date. Intraday order is unknown.",
    structural_only: "The links exist, but no transfer sequence meets the 0–2 day gap rule. Inspect each link separately.",
  },
  ru: {
    direct_transfer: "Одна наблюдаемая связь. Показан самый ранний перевод; дальнейшее движение средств не установлено.",
    date_ordered: "Каждый следующий перевод произошёл через 1–2 календарных дня. Суммы могут различаться; движение тех же денег не доказано.",
    same_day_order_unknown: "Есть последовательность с интервалами 0–2 дня, но хотя бы один шаг приходится на тот же день. Порядок внутри дня неизвестен.",
    structural_only: "Связи существуют, но нет последовательности переводов с интервалами 0–2 дня. Изучите каждую связь отдельно.",
  },
};
const REQUESTS_RU: Record<string, [string, string]> = {
  onward_transfers: ["Обход остановлен на глубине 4; дальнейшая активность не наблюдается.", "Запросить исходящие переводы этого счёта за границей текущего обхода."],
  full_account_transfers: ["У счёта нет наблюдаемых связей в выгрузке.", "Запросить полные входящие и исходящие переводы за период выгрузки."],
  seed_inbound: ["Обход начинается с этого seed-счёта; входящие переводы из-за пределов выборки отсутствуют.", "Запросить входящие переводы, включая отправителей вне наблюдаемой сети."],
  intraday_timestamps: ["Один из маршрутов опирается на переводы в один день; порядок неизвестен.", "Запросить время и часовой пояс указанных переводов, включая промежуточные счета."],
};

export function InvestigationPanel({ gid, data, status, language, activeRoute, onRoute, onClear, onAccount }: {
  gid: string;
  data: MoneyInvestigations | null;
  status: "available" | "missing" | "invalid";
  language: Language;
  activeRoute: InvestigationRoute | null;
  onRoute: (route: InvestigationRoute) => void;
  onClear: () => void;
  onAccount: (gid: string) => void;
}) {
  const [filter, setFilter] = useState<TimingStatus | "all">("all");
  const [limit, setLimit] = useState(5);
  const ru = language === "ru";
  const account = data?.accounts[gid];
  if (!data || !account) return <section className="investigation-panel" role="status">
    <h3>{ru ? "Материалы исследования" : "Investigation evidence"}</h3>
    <p>{status === "invalid"
      ? (ru ? "Материалы не соответствуют текущей выгрузке или повреждены. Анализ счёта остаётся доступным." : "Evidence does not match this analysis or is invalid. Account analysis is still available.")
      : (ru ? "Для этой выгрузки материалы исследования ещё не доступны." : "Investigation evidence is not available for this export yet.")}</p>
  </section>;
  const routes = account.routes.filter(route => filter === "all" || route.timing_status === filter);
  const activeKey = activeRoute?.gids.join(":");
  const amount = (value: number) => `${new Intl.NumberFormat(ru ? "ru-RU" : "en-US").format(value)} KZT`;
  return <section className="investigation-panel">
    <h3>{ru ? "Маршруты от seed-счетов" : "Routes from seed accounts"}</h3>
    <p>{account.route_count} {ru ? "маршрутов · источников seed:" : "routes · source seeds:"} {account.source_seed_count}</p>
    <p className="evidence-note">{ru ? "Маршруты могут пересекаться. Это связи в выборке, а не доказанные потоки одних и тех же денег. Суммы по шагам не складываются." : "Routes may overlap. They describe observed connections, not proven movement of identical funds. Do not add amounts across steps."}</p>
    {account.routes.length ? <>
      <label className="route-filter">{ru ? "Поддержка по времени" : "Timing evidence"}
        <select value={filter} onChange={event => { setFilter(event.target.value as TimingStatus | "all"); setLimit(5); }}>
          <option value="all">{ru ? "Все маршруты" : "All routes"}</option>
          {Object.entries(LABELS[language]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p>{routes.length} {ru ? "маршрутов в фильтре" : "matching routes"}</p>
      {!routes.length && <p>{ru ? "Нет маршрутов с выбранной поддержкой по времени." : "No routes have this timing classification."}</p>}
      <div className="route-list">{routes.slice(0, limit).map(route => {
        const key = route.gids.join(":");
        return <button key={key} className={`route-card ${key === activeKey ? "active" : ""}`} aria-pressed={key === activeKey} onClick={() => onRoute(route)}>
          <b className={`timing-badge ${route.timing_status}`}>{LABELS[language][route.timing_status]}</b>
          <span>{route.gids.join(" → ")}</span>
          <small>{route.gids.length - 1} {ru ? "шагов · открыть на карте" : "hops · inspect on map"}</small>
        </button>;
      })}</div>
      {limit < routes.length && <button className="evidence-button" onClick={() => setLimit(value => value + 5)}>{ru ? "Ещё 5 маршрутов" : "Show 5 more routes"}</button>}
    </> : <p className="evidence-note">{ru ? "Не найдено маршрутов от seed-счетов в пределах четырёх шагов. Это не означает отсутствие связи или риска." : "No seed route found within four edges. This does not establish absence of a connection or risk."}</p>}

    {activeRoute && <div className="route-evidence" aria-label={ru ? "Переводы выбранного маршрута" : "Selected route transfers"}>
      <div className="evidence-heading"><h4>{LABELS[language][activeRoute.timing_status]}</h4><button onClick={onClear}>{ru ? "Закрыть маршрут" : "Clear route"}</button></div>
      <p>{DESCRIPTIONS[language][activeRoute.timing_status]}</p>
      {activeRoute.gids.slice(0, -1).map((src, index) => {
        const dst = activeRoute.gids[index + 1];
        const witnessId = activeRoute.witness_transaction_ids[index];
        const witness = data.transactions[witnessId];
        const ids = data.edge_transactions[src]?.[dst] ?? [];
        return <article key={`${src}:${dst}`} className="transfer-step">
          <b>{ru ? "Шаг" : "Step"} {index + 1}</b>
          <div className="transfer-accounts"><button onClick={() => onAccount(src)}>{src}</button><span>→</span><button onClick={() => onAccount(dst)}>{dst}</button></div>
          {witness && <div className="witness"><strong>{witness.date} · {amount(witness.sum_kzt)}</strong><small>{witnessId}</small></div>}
          <details><summary>{ru ? "Все переводы по связи" : "All transfers on this link"} ({ids.length})</summary>
            <ul className="transfer-records">{ids.map(id => { const tx = data.transactions[id]; return <li key={id}><span>{tx.date} · {amount(tx.sum_kzt)}</span><small>{id}</small></li>; })}</ul>
          </details>
        </article>;
      })}
      <p className="evidence-note">{ru ? "Идентификаторы переводов относятся только к этой выгрузке. Совпадающие записи сохранены отдельно." : "Transfer IDs are local to this export. Identical records remain separate transfers."}</p>
    </div>}

    <div className="data-requests"><h4>{ru ? "Какие данные запросить" : "What data to request next"}</h4>
      {account.next_data_requests.length ? account.next_data_requests.map(request => {
        const translated = ru ? REQUESTS_RU[request.code] : undefined;
        return <article key={request.code}><p>{translated?.[0] ?? request.reason}</p><strong>{translated?.[1] ?? request.requested_data}</strong>
          {!!request.transaction_ids?.length && <details><summary>{ru ? "Переводы для уточнения времени" : "Transfers needing timestamps"} ({request.transaction_ids.length})</summary><ul className="transfer-records">{request.transaction_ids.map(id => {
            const tx = data.transactions[id];
            return <li key={id}><span>{tx.date} · {amount(tx.sum_kzt)}</span><small>{tx.src} → {tx.dst} · {id}</small></li>;
          })}</ul></details>}
        </article>;
      }) : <p>{ru ? "Специальных запросов по текущим правилам нет. Общие ограничения выгрузки сохраняются." : "No account-specific request under the current rules. Export-wide limitations still apply."}</p>}
      <p className="evidence-note">{ru ? "Рекомендации для аналитика. Запросы автоматически не отправляются." : "Suggestions for analyst review. No requests are sent automatically."}</p>
    </div>
    <details><summary>{ru ? "Границы данных" : "Data coverage"}</summary>
      {ru ? <ul className="coverage-list"><li>Видны только внутрибанковские переводы от 5 000 KZT за период выгрузки.</li><li>Обход ограничен четырьмя шагами. Входящие переводы из-за пределов выборки неполны.</li><li>Время внутри дня неизвестно. Совпадение дат не доказывает движение тех же денег.</li><li>Не выполняются сопоставление сумм, поиск повторений или выводы о виновности.</li></ul>
        : <ul className="coverage-list">{data.meta.coverage_limitations.map(text => <li key={text}>{text}</li>)}</ul>}
    </details>
  </section>;
}
