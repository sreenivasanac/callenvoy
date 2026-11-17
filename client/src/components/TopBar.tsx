import { router, usePathname } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type PressableStateCallbackType } from 'react-native';
import { useGo, useSession } from '../hooks';
import { border, color, font, menuWidth, radius, space, useWide } from '../theme';
import { useSignOut } from './Account';
import { Button, text } from './ui';

type Hover = PressableStateCallbackType & { hovered?: boolean };

/** The bar at the top of every page: the app name (a link to the start page), then `children` (on the right).
 *  `below`: a second row (phone widths). */
export function AppBar({ children, below, home }: { children: ReactNode; below?: ReactNode; home?: () => void }) {
  const wide = useWide();
  return (
    <View style={[s.bar, wide && s.barWide]} role="banner">
      <View style={[s.row, wide && s.rowWide]}>
        <Pressable role="link" aria-label="CallEnvoy, start page" onPress={home ?? (() => router.push('/'))} style={s.brand}>
          <View style={s.mark} aria-hidden>
            <View style={s.markDot} />
          </View>
          <Text style={[text.brand, !wide && s.brandNarrow]} numberOfLines={1}>
            CallEnvoy
          </Text>
        </Pressable>
        {children}
      </View>
      {below}
    </View>
  );
}

/** One link in a bar; `on` marks the current page. */
export function BarLink({ label, on, onPress, grow }: { label: string; on?: boolean; onPress: () => void; grow?: boolean }) {
  const wide = useWide();
  return (
    <Pressable role="link" aria-current={on ? 'page' : undefined} onPress={onPress} style={[s.link, wide && s.linkWide, grow && s.fill, on && s.on]}>
      {(st: Hover) => <Text style={[s.linkText, !wide && s.linkTextNarrow, grow && s.center, st.hovered && s.linkTextHover, on && s.linkTextOn]}>{label}</Text>}
    </Pressable>
  );
}

/** Console: screen links, New call, and the account menu. The admin also gets People. */
export function TopBar() {
  const wide = useWide();
  const path = usePathname();
  const go = useGo();
  const { me } = useSession();
  const admin = !!me?.is_admin;
  const twoRows = !wide; // the links get their own row on phones
  const link = (href: string, label: string) => (
    <BarLink key={href} label={label} grow={twoRows} on={href === '/' ? path === '/' || path.startsWith('/calls') : path.startsWith(href)} onPress={() => go(href)} />
  );
  const nav = (
    <View style={[s.nav, wide && s.navWide]} role="navigation" aria-label="Console">
      {link('/', 'Calls')}
      {link('/agents', 'Agents')}
      {link('/settings', 'Settings')}
      {admin && link('/people', 'People')}
    </View>
  );
  return (
    <AppBar below={twoRows ? nav : null} home={() => go('/')}>
      {twoRows ? <View style={s.fill} /> : nav}
      <View>
        <Button label="New call" size="small" onPress={() => go('/new')} />
      </View>
      <AccountMenu />
    </AppBar>
  );
}

/** The round button with the first letter of the address: who is signed in, Settings, Sign out. */
function AccountMenu() {
  const { me } = useSession();
  const go = useGo();
  const [open, setOpen] = useState(false);
  const out = useSignOut();
  const email = me?.email ?? '';
  const item = (label: string, onPress: () => void) => (
    <Pressable
      role="menuitem"
      onPress={() => {
        setOpen(false);
        onPress();
      }}
      style={(st: Hover) => [s.item, st.hovered && s.itemHover]}
    >
      <Text style={text.base}>{label}</Text>
    </Pressable>
  );
  return (
    <View>
      <Pressable role="button" aria-label={`Account: ${email}`} aria-haspopup="menu" aria-expanded={open} onPress={() => setOpen(!open)} style={(st: Hover) => [s.avatar, (st.hovered || open) && s.avatarOn]}>
        <Text style={s.avatarText}>{(email[0] ?? '?').toUpperCase()}</Text>
      </Pressable>
      <Modal transparent visible={open} onRequestClose={() => setOpen(false)} animationType="none">
        <Pressable style={s.away} onPress={() => setOpen(false)} aria-label="Close the account menu" />
        <View style={s.menu} role="menu" aria-label="Account">
          <View style={s.who}>
            <Text style={text.fine}>Signed in as</Text>
            <Text style={[text.base, s.email]} numberOfLines={1}>
              {email}
            </Text>
          </View>
          {item('Settings', () => go('/settings'))}
          {item('Sign out', out.ask)}
        </View>
      </Modal>
      {out.sheet}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  bar: { paddingVertical: space.m, paddingHorizontal: space.xl, gap: space.sm, borderBottomWidth: border.thin, borderBottomColor: color.line, backgroundColor: color.topbar },
  barWide: { paddingVertical: space.ml, paddingHorizontal: space.x4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  rowWide: { gap: space.l },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1, minWidth: 0 },
  brandNarrow: { fontSize: font.size.big },
  // The mark: a phone line's end, a ring with a dot.
  mark: { width: space.xxl, height: space.xxl, borderRadius: radius.pill, borderWidth: border.edge, borderColor: color.brand, alignItems: 'center', justifyContent: 'center' },
  markDot: { width: space.s, height: space.s, borderRadius: radius.pill, backgroundColor: color.brand },
  nav: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  navWide: { flexGrow: 1, justifyContent: 'flex-end' },
  link: { paddingVertical: space.s, paddingHorizontal: space.m, borderRadius: radius.pill },
  linkWide: { paddingHorizontal: space.l },
  on: { backgroundColor: color.selected },
  linkText: { color: color.soft, fontWeight: font.weight.semi, fontSize: font.size.base },
  linkTextNarrow: { fontSize: font.size.m },
  linkTextHover: { color: color.fg },
  linkTextOn: { color: color.onSelected },
  center: { textAlign: 'center' },
  avatar: { width: space.x4 + space.xs, height: space.x4 + space.xs, borderRadius: radius.pill, borderWidth: border.thin, borderColor: color.edge, backgroundColor: color.card, alignItems: 'center', justifyContent: 'center' },
  avatarOn: { borderColor: color.brand },
  avatarText: { color: color.fg, fontSize: font.size.m, fontWeight: font.weight.bold },
  away: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  menu: { position: 'absolute', top: space.x5 + space.sm, right: space.xl, width: menuWidth, maxWidth: '90%', backgroundColor: color.card, borderWidth: border.thin, borderColor: color.line, borderRadius: radius.l, paddingVertical: space.s, boxShadow: `0 8px 24px ${color.shadow}` },
  who: { paddingVertical: space.sm, paddingHorizontal: space.l, borderBottomWidth: border.thin, borderBottomColor: color.line, marginBottom: space.xs },
  email: { fontWeight: font.weight.semi },
  item: { paddingVertical: space.m, paddingHorizontal: space.l },
  itemHover: { backgroundColor: color.card2 },
});
