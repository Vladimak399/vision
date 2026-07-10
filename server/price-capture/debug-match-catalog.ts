import type { CatalogMatchProduct } from "../catalog-matching";

export const DEBUG_MATCH_CATALOG_SOURCE = "built-in-debug-catalog-v1" as const;

export const DEBUG_MATCH_CATALOG: CatalogMatchProduct[] = [
  {
    id: "debug-coffee-jockey-traditional-250g",
    name: "Кофе Жокей Традиционный молотый 250 г",
    brand: "Жокей",
    size_text: "250 г",
    is_active: true,
  },
  {
    id: "debug-coffee-jockey-classic-250g",
    name: "Кофе Жокей Классический растворимый 250 г",
    brand: "Жокей",
    size_text: "250 г",
    is_active: true,
  },
  {
    id: "debug-coffee-nescafe-classic-95g",
    name: "Кофе Nescafe Classic растворимый 95 г",
    brand: "Nescafe",
    size_text: "95 г",
    is_active: true,
  },
  {
    id: "debug-tea-princess-nuri-25pc",
    name: "Чай Принцесса Нури черный 25 пак",
    brand: "Принцесса Нури",
    size_text: "25 шт",
    is_active: true,
  },
  {
    id: "debug-yashkino-cookies-182g",
    name: "Печенье Яшкино сдобное 182 г",
    brand: "Яшкино",
    size_text: "182 г",
    is_active: true,
  },
];
