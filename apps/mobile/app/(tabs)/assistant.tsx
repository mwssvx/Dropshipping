import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState, Screen } from "../../src/ui";

export default function AssistantScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen title="Assistant">
        <EmptyState heading="Coming in the app milestone" body="Ask what's wrong with your store and get fixes you approve. A person is one tap away." coming="Milestone 6" />
      </Screen>
    </SafeAreaView>
  );
}
