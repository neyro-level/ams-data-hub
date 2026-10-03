const DEFAULT_DATABASE_PAGE_SIZE = 100;

export async function collectDatabasePages<T>(
  readPage: (pagination: { skip: number; take: number }) => Promise<T[]>,
  pageSize = DEFAULT_DATABASE_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error("DATABASE_PAGE_SIZE_INVALID");
  }

  const records: T[] = [];
  while (true) {
    const page = await readPage({ skip: records.length, take: pageSize });
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}
