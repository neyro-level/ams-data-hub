export const legalOperator = {
  name: "TODO: юридическое лицо или ИП",
  inn: "TODO: ИНН",
  ogrnip: "TODO: ОГРН/ОГРНИП",
  address: "TODO: юридический адрес",
  email: "TODO: email оператора",
  phone: "TODO: телефон",
  site: "https://ams-start.example",
} as const;

export const publicContacts = {
  telegram: "https://example.com/telegram",
  max: "https://example.com/max",
} as const;

export const legalLinks = [
  { href: "/politika/", label: "Политика конфиденциальности" },
  { href: "/soglasie/", label: "Согласие на обработку данных" },
  { href: "/cookies/", label: "Использование Cookie" },
  { href: "/terms/", label: "Условия сотрудничества" },
] as const;
