// The frame of the public pages (product page, examples, privacy, terms): the bar, the page column, the footer.
import { router, usePathname } from 'expo-router';
import { type ReactNode, useEffect } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../hooks';
import { setTitle } from '../platform/head';
import { border, color, maxContent, readWidth, space, useWide } from '../theme';
import { AppBar, BarLink } from './TopBar';
import { track } from '../platform/analytics';
import { Button, T, text, TextLink } from './ui';

export const REPO_URL = 'https://github.com/sreenivasanac/holdforme';
const open = (url: string) => void Linking.openURL(url);

/** `onSignIn`: what the Sign in button does (the product page scrolls to its form; other pages go there). */
export function PublicPage({ title, children, onSignIn }: { title: string; children: ReactNode; onSignIn?: () => void }) {
  const { me } = useSession();
  const wide = useWide();
  const path = usePathname();
  useEffect(() => setTitle(title), [title]);
  return (
    <View style={s.fill}>
      <AppBar>
        <View style={s.fill} />
        <View style={s.nav} role="navigation" aria-label="Site">
          <BarLink label="Examples" on={path === '/examples'} onPress={() => router.push('/examples')} />
          {wide ? <BarLink label="GitHub" onPress={() => open(REPO_URL)} /> : null}
        </View>
        {me?.signed_in ? (
          <Button label={wide ? 'Open the console' : 'Console'} size="small" onPress={() => router.push('/')} />
        ) : (
          <Button
            label="Sign in"
            kind="secondary"
            size="small"
            onPress={() => {
              track('sign-in');
              (onSignIn ?? (() => router.push('/?signin=1')))();
            }}
          />
        )}
      </AppBar>
      <ScrollView style={s.fill} contentContainerStyle={s.page}>
        <View role="main" style={s.main}>
          {children}
        </View>
        <View role="contentinfo" style={s.footer}>
          <Text style={text.fine}>CallEnvoy is open source and run by one person. It comes with no warranty.</Text>
          <View style={s.links}>
            <TextLink label="Examples" onPress={() => router.push('/examples')} />
            <TextLink label="Privacy" onPress={() => router.push('/privacy')} />
            <TextLink label="Terms" onPress={() => router.push('/terms')} />
            <TextLink label="Source code" onPress={() => open(REPO_URL)} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** A page of plain text (privacy, terms): a title, a date line, then sections. */
export function TextPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: [string, string[]][] }) {
  return (
    <PublicPage title={`${title} - CallEnvoy`}>
      <View style={s.read}>
        <T v="h1" style={s.h1}>
          {title}
        </T>
        <T v="fine">{`Last changed ${updated}`}</T>
        <T v="soft" style={s.intro}>
          {intro}
        </T>
        {sections.map(([head, paragraphs]) => (
          <View key={head} style={s.section}>
            <T v="h2" style={s.h2}>
              {head}
            </T>
            {paragraphs.map((p) => (
              <T key={p} v="body">
                {p}
              </T>
            ))}
          </View>
        ))}
      </View>
    </PublicPage>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center' },
  page: { width: '100%', maxWidth: maxContent, alignSelf: 'center', paddingHorizontal: space.xl, paddingBottom: space.x4, flexGrow: 1 },
  main: { flexGrow: 1 },
  footer: { marginTop: space.x5 + space.x3, paddingTop: space.xl, borderTopWidth: border.thin, borderTopColor: color.line, gap: space.sm },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl, rowGap: space.xs },
  read: { maxWidth: readWidth, paddingTop: space.x5, gap: space.ml },
  h1: { marginBottom: 0 },
  h2: { marginBottom: 0 },
  intro: { marginTop: space.sm },
  section: { gap: space.sm, marginTop: space.xl },
});
