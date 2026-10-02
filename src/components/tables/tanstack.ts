import { coreFeatures, createCoreRowModel, tableFeatures } from "@tanstack/react-table";

export const starterTableFeatures = tableFeatures({
  ...coreFeatures,
  coreRowModel: createCoreRowModel(),
});
