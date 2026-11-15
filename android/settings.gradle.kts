pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
    resolutionStrategy {
        eachPlugin {
            if (requested.id.id == "com.android.application" || requested.id.id == "com.android.library" || requested.id.id == "org.jetbrains.kotlin.android") {
                useModule("com.android.tools.build:gradle:8.7.3")
            }
            if (requested.id.id == "org.jetbrains.kotlin.android" || requested.id.id == "org.jetbrains.kotlin.multiplatform") {
                useModule("org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21")
            }
            if (requested.id.id == "com.google.dagger.hilt.android") {
                useModule("com.google.dagger:hilt-android-gradle-plugin:2.52")
            }
        }
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
    versionCatalogs {
        create("libs") {
            from(files("gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "VelnoxAndroid"

include(":core:core-common")
include(":core:core-datastore")
include(":core:core-designsystem")
include(":core:core-network")
include(":core:core-auth")
include(":core:core-navigation")
include(":app-velshop")
include(":app-velseller")
