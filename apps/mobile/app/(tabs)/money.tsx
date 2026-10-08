import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState, Screen } from "../../src/ui";

export default function MoneyScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen title="Money">
        <EmptyState heading="Coming in the app milestone" body="Your balance and payouts. If a payout is ever held, you'll see why, what we need, and when it clears." coming="Milestone 6" />
      </Screen>
    </SafeAreaView>
  );
}
