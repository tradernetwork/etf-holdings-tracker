import { useQuery } from "@tanstack/react-query";
import { fetchIncomeDirectory } from "./incomeDirectory";

export const useIncomeDirectory = () =>
  useQuery({ queryKey: ["income-directory"], queryFn: ({ signal }) => fetchIncomeDirectory(signal), staleTime: 5 * 60 * 1000 });
