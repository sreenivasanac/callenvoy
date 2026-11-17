import { StyleSheet, View } from 'react-native';
import { ExamplesList } from '../components/Examples';
import { PublicPage } from '../components/Public';
import { T } from '../components/ui';
import { readWidth, space } from '../theme';

/** /examples (public): recorded calls with their transcripts. */
export default function ExamplesScreen() {
  return (
    <PublicPage title="Example calls - CallEnvoy">
      <View style={s.head}>
        <T v="h1" style={s.h1}>
          Example calls
        </T>
        <T v="soft">Real calls, recorded on our demo phone line. The names are fictional. Press play and follow the call along its line; click a transcript line to jump there.</T>
      </View>
      <ExamplesList />
    </PublicPage>
  );
}

const s = StyleSheet.create({
  head: { maxWidth: readWidth, paddingTop: space.x5, paddingBottom: space.x4, gap: space.ml },
  h1: { marginBottom: 0 },
});
