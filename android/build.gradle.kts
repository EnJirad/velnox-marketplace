buildscript {
    dependencies {
        libs.plugins.android.application.add()
        libs.plugins.android.library.add()
        libs.plugins.kotlin.android.add()
        libs.plugins.kotlin.compose.add()
        libs.plugins.kotlin.serialization.add()
        libs.plugins.hilt.add()
    }
}

allprojects {
    group = "com.velnox"
    version = "1.0.0"
}

tasks.register("clean", Delete::class) {
    delete(rootProject.buildDir)
}
