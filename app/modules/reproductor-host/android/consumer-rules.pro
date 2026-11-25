# Rules for the release build (R8) of the app that uses this module.

# Optional classes that some libraries name but do not need (annotations of Tink, used by androidx.security).
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# Found by reflection: NanoHTTPD's own classes.
-keep class fi.iki.elonen.** { *; }
