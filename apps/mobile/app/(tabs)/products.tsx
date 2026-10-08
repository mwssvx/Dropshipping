import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState, Screen } from "../../src/ui";

export default function ProductsScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen title="Products">
        <EmptyState heading="Coming in the app milestone" body="Import a product by sharing a supplier link to this app, review the AI-written listing and publish." coming="Milestone 6" />
      </Screen>
    </SafeAreaView>
  );
}
