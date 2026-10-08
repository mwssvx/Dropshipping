import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState, Screen } from "../../src/ui";

export default function OrdersScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen title="Orders">
        <EmptyState heading="Coming in the app milestone" body="Paid orders appear here with their delivery status. Fix problem orders and refund from your phone." coming="Milestone 6" />
      </Screen>
    </SafeAreaView>
  );
}
