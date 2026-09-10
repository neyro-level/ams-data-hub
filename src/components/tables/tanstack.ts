import { coreFeatures, createCoreRowModel, tableFeatures } from "@tanstack/react-table";

export const impulseTableFeatures = tableFeatures({
  ...coreFeatures,
  coreRowModel: createCoreRowModel(),
});
