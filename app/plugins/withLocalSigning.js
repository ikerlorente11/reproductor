// Release signing for local builds (`gradlew bundleRelease` / `assembleRelease`): if app/credentials.json exists
// (the same format as EAS local credentials), the release build is signed with that upload key; without it,
// with the debug key as Expo does by default.
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins')

const CREDS = "rootProject.file('../credentials.json')"

// R8 runs out of memory with Expo's default 2 GB heap (the daemon dies: "Could not receive a message from the daemon")
function withGradleMemory(config) {
  return withGradleProperties(config, (c) => {
    const jvm = c.modResults.find((p) => p.type === 'property' && p.key === 'org.gradle.jvmargs')
    if (jvm) jvm.value = '-Xmx6144m -XX:MaxMetaspaceSize=1024m'
    return c
  })
}

module.exports = function withLocalSigning(config) {
  config = withGradleMemory(config)
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents
    if (g.includes('credentials.json')) return c
    g = g.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig ${CREDS}.exists() ? signingConfigs.release : signingConfigs.debug`,
    )
    g = g.replace(
      /signingConfigs \{/,
      `signingConfigs {
        release {
            def creds = ${CREDS}
            if (creds.exists()) {
                def k = new groovy.json.JsonSlurper().parse(creds).android.keystore
                storeFile rootProject.file('../' + k.keystorePath)
                storePassword k.keystorePassword
                keyAlias k.keyAlias
                keyPassword k.keyPassword
            }
        }`,
    )
    c.modResults.contents = g
    return c
  })
}
