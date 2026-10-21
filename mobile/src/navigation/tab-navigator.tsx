import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/js-tabs";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ConnectionBadge } from "@/components/connection-badge";
import { useConnection } from "@/connection/connection-provider";
import { useTheme } from "@/theme/theme-provider";
import { SPACING } from "@/theme/tokens";

import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface TabIconProps {
  readonly focused: boolean;
  readonly color: ColorValue;
  readonly size: number;
}

const styles = StyleSheet.create({
  headerBadge: { marginRight: SPACING.large },
});

// The active icon is the Pica orange; the label stays in the foreground color,
// because orange text on the tab bar does not reach a readable contrast.
function tabIcon(
  name: IconName,
  activeColor: ColorValue,
): (props: TabIconProps) => React.ReactElement {
  return function TabIcon({
    focused,
    color,
    size,
  }: TabIconProps): React.ReactElement {
    return (
      <Ionicons color={focused ? activeColor : color} name={name} size={size} />
    );
  };
}

function ConnectionHeaderBadge(): React.ReactElement {
  const { status } = useConnection();

  return (
    <View style={styles.headerBadge}>
      <ConnectionBadge status={status} />
    </View>
  );
}

/** The two tabs of the app: Pica's conversations and the settings. */
export function TabNavigator(): React.ReactElement {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.pica"),
          tabBarIcon: tabIcon("chatbubble-ellipses-outline", colors.primary),
          headerRight: ConnectionHeaderBadge,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: tabIcon("settings-outline", colors.primary),
        }}
      />
    </Tabs>
  );
}
