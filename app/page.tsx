import Link from "next/link";

const foundationItems = [
  "Роли, доступы и безопасная работа с компаниями",
  "Импорт каталога с проверкой цен и SKU",
  "Сессии мониторинга и массовая загрузка фото",
  "AI-распознавание, matching и review спорных позиций",
  "Excel-отчеты с фото-evidence для команды",
];

const metrics = [
  ["5", "ключевых этапов закрыты в одном интерфейсе"],
  ["AI", "распознает товары и цены по фотографиям полок"],
  ["Excel", "готовит отчетность для контроля и аудита"],
];

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero-panel">
        <div className="hero" style={{ position: "relative", zIndex: 1 }}>
          <div>
            <p className="eyebrow">PriceVision · retail monitoring</p>
            <h1>Понятный контроль цен по фотографиям магазинов</h1>
            <p className="lead">
              Современная рабочая область для команд, которые собирают фото полок,
              сопоставляют товары с каталогом, проверяют спорные позиции и выгружают
              доказательную отчетность без хаоса в таблицах.
            </p>
          </div>
          <div className="actions">
            <Link className="btn" href="/app">
              Открыть приложение
            </Link>
            <Link className="btn btn-secondary" href="/ocr-test">
              Сравнить цены конкурента
            </Link>
            <Link className="btn btn-secondary" href="/login?next=/app">
              Войти
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-3" aria-label="Ключевые показатели">
        {metrics.map(([value, label]) => (
          <div className="stat" key={label}>
            <b>{value}</b>
            <p className="muted" style={{ marginBottom: 0 }}>{label}</p>
          </div>
        ))}
      </section>

      <section className="card soft">
        <div className="hero">
          <div>
            <p className="eyebrow">Что уже заложено</p>
            <h2>Один маршрут от каталога до отчета</h2>
            <p className="lead">
              Интерфейс собран вокруг понятного процесса: подготовить справочник,
              создать мониторинг, загрузить фото, разобрать результаты и экспортировать отчет.
            </p>
          </div>
        </div>
        <div className="grid grid-2" style={{ marginTop: "1rem" }}>
          {foundationItems.map((item) => (
            <div key={item} className="card" style={{ boxShadow: "none" }}>
              <span className="badge badge-info">Готово к работе</span>
              <p style={{ marginBottom: 0, fontWeight: 800 }}>{item}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
