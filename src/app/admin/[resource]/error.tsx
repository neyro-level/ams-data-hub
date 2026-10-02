"use client";

import { Button } from "../../../components/ui/button.tsx";
import { ErrorState } from "../../../components/states/StatePanel.tsx";

export default function AdminResourceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl py-6">
      <ErrorState title="Не удалось загрузить раздел администрирования" description="Повторите запрос. Если ошибка сохранится, сообщите время её появления." action={<Button onClick={reset} type="button">Повторить</Button>} />
    </div>
  );
}
