import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState, Screen } from "../../src/ui";

export default function Today() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen title="Today">
        <EmptyState heading="Needs your attention" body="Problem orders, payout holds and low supplier stock land here, each with a one-tap fix." />
        <EmptyState heading="Agent proposals" body="Price changes, supplier swaps and refunds your AI agents suggest wait here for a swipe to approve." coming="Arrives with AI agents" />
      </Screen>
    </SafeAreaView>
  );
}
