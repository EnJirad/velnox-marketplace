# VelShop ProGuard Rules

# Keep Hilt generated classes
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.HiltAndroidApp
-keep class * extends dagger.hilt.android.HiltViewModel

# Keep Moshi adapters
-keep class com.squareup.moshi.** { *; }
-keep @com.squareup.moshi.JsonClass interface *
-keep @com.squareup.moshi.JsonClass class *
-keepclassmembers @com.squareup.moshi.JsonClass class * { *; }

# Keep Kotlin serialization
-keep class kotlinx.serialization.** { *; }
-keep @kotlinx.serialization.Serializable class *
-keepclassmembers @kotlinx.serialization.Serializable class * { *; }

# Keep Retrofit
-keep class retrofit2.** { *; }
-keep interface * extends retrofit2.http.HttpMethod
-keepclassmembers interface * {
    @retrofit2.http.* <methods>;
}

# Keep OkHttp
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# Keep Coil
-keep class coil.** { *; }

# Keep Hilt Navigation Compose
-keep class androidx.hilt.navigation.compose.** { *; }

# Keep Material3
-keep class androidx.compose.material3.** { *; }

# Keep Navigation Compose
-keep class androidx.navigation.compose.** { *; }

# Keep Lifecycle ViewModel
-keep class androidx.lifecycle.** { *; }
-keepclassmembers class * extends androidx.lifecycle.ViewModel {
    <init>(...);
}

# Keep Result sealed class
-keep class com.velnox.core.common.result.** { *; }

# Keep Velnox design system
-keep class com.velnox.core.designsystem.** { *; }

# Keep Velnox network
-keep class com.velnox.core.network.** { *; }

# Keep Velnox auth
-keep class com.velnox.core.auth.** { *; }

# Keep Velnox navigation
-keep class com.velnox.core.navigation.** { *; }

# Keep Velnox datastore
-keep class com.velnox.core.datastore.** { *; }

# Keep BuildConfig
-keep class com.velnox.velshop.BuildConfig { *; }

# Keep R class
-keep class com.velnox.velshop.R$* { *; }

# Suppress warnings for third-party libraries
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn com.squareup.moshi.**
-dontwarn kotlinx.serialization.**
-dontwarn coil.**
-dontwarn dagger.hilt.**
-dontwarn androidx.hilt.**
-dontwarn androidx.navigation.compose.**
-dontwarn androidx.compose.material3.**
-dontwarn kotlinx.coroutines.**

# Remove logging in release
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
    public static *** w(...);
}

# Keep custom views
-keep public class * extends android.view.View {
    public <init>(android.content.Context);
    public <init>(android.content.Context, android.util.AttributeSet);
    public <init>(android.content.Context, android.util.AttributeSet, int);
    public <init>(android.content.Context, android.util.AttributeSet, int, int);
    public void set*(...);
}

# Keep Parcelable implementations
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Keep Enum values
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
