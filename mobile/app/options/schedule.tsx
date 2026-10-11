import { Text } from "react-native";
import { ScheduleCard } from "@/components/options/ScheduleCard";
import { Card, ErrorNote, Hint, Loading, Note, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useMwfSchedule } from "@/lib/options/queries";
import { display } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** MWF Elite expiration schedule: status, next expiration, upcoming NYSE holidays and the eligible symbols. */
export default function ScheduleScreen() {
  const c = useTheme();
  const q = useMwfSchedule();
  const missing = q.error instanceof ApiError && q.error.status === 404;
  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={{ color: c.textPrimary, ...display, fontSize: 30 }}>Expiration schedule</Text>
      <Hint>The 12 symbols approved for Monday / Wednesday / Friday weekly options, excluding SPY and QQQ. Days are New York time; NYSE holidays are skipped.</Hint>
      {q.isLoading && <Loading />}
      {q.data && <ScheduleCard schedule={q.data} full />}
      {missing && <Card><Note>This server doesn't publish the expiration schedule yet. It will appear after the next API update.</Note></Card>}
      {q.isError && !missing && <ErrorNote message="Couldn't load the schedule." onRetry={() => q.refetch()} />}
    </Screen>
  );
}
