import { router, type Href } from "expo-router";
import { Linking } from "react-native";
import { useApi } from "../src/api";
import { API_URL } from "../src/config";
import { BackLink, Body, Heading, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";

type Check = { key: string; title: string; done: boolean; detail: string; app: string | null; web: string };

/**
 * The holiday checklist from the website: each line ticks itself once it's set up. Lines the app
 * can set up open that screen; the rest open the website.
 */
export default function HolidayChecklistScreen() {
  const data = useApi<{ season: boolean; checks: Check[] }>("holiday-checklist");
  const d = data.data;
  const left = d ? d.checks.filter((c) => !c.done).length : 0;
  return (
    <Screen title="Holiday checklist" back={<BackLink href="/" label="Today" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>The busiest weeks of the year. Each line ticks itself once it's set up.</Body>
          <Heading>{left === 0 ? "All set for the holidays." : `${d.checks.length - left} of ${d.checks.length} done`}</Heading>
          {(["To do", "Done"] as const).map((group) => {
            const rows = d.checks.filter((c) => (group === "Done") === c.done);
            if (!rows.length) return null;
            return (
              <Section key={group} title={group}>
                <List>
                  {rows.map((c) => (
                    <Row
                      key={c.key}
                      title={c.title}
                      subtitle={c.detail}
                      a11y={`${c.title}${c.done ? ", done" : ""}${c.app ? "" : ", opens the website"}`}
                      right={<Pill label={c.done ? "Done" : c.app ? "Set up" : "Website ↗"} tone={c.done ? "success" : c.app ? "info" : "neutral"} />}
                      onPress={() => (c.app ? router.push(c.app as Href) : void Linking.openURL(`${API_URL}${c.web}`))}
                    />
                  ))}
                </List>
              </Section>
            );
          })}
        </>
      )}
    </Screen>
  );
}
