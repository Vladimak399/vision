const foundationItems = [
  "Auth, roles and Supabase RLS",
  "Catalog import and validation",
  "Monitoring sessions and bulk photo upload",
  "Recognition, matching and review",
  "Excel reports with photo evidence",
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <section className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">PriceVision</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Мониторинг розничных цен по фотографиям магазинов
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
          Foundation проекта готовится под импорт ассортимента, загрузку фото, AI-распознавание,
          сопоставление товаров, review спорных позиций и Excel-отчеты с evidence.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {foundationItems.map((item) => (
            <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700">
              {item}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
