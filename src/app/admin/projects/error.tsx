"use client";

import { Button } from "../../../components/ui/button.tsx";
import { ErrorState } from "../../../components/states/StatePanel.tsx";

export default function ProjectsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl py-6">
      <ErrorState title="Не удалось загрузить проекты" description="Повторите запрос. Если ошибка сохранится, сообщите время её появления." action={<Button onClick={reset} type="button">Повторить</Button>} />
    </div>
  );
}
