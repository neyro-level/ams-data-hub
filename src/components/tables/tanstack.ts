import { coreFeatures, createCoreRowModel, tableFeatures } from "@tanstack/react-table";

export const dataHubTableFeatures = tableFeatures({
  ...coreFeatures,
  coreRowModel: createCoreRowModel(),
});
