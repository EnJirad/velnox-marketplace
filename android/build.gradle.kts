buildscript {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
    dependencies {
        // AGP
        classpath("com.android.tools.build:gradle:8.7.3")
        // Kotlin
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21")
        // Hilt
        classpath("com.google.dagger:hilt-android-gradle-plugin:2.52")
    }
}

allprojects {
    group = "com.velnox"
    version = "1.0.0"
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

tasks.register("clean", Delete::class) {
    delete(rootProject.buildDir)
}
