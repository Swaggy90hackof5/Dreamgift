plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Release signing is read from environment variables (set by the GitHub Actions workflow).
// If they are absent, the release build is simply left unsigned.
val keystorePath: String? = System.getenv("KEYSTORE_PATH")

// Where the DreamGift backend lives. Set with  -PbackendUrl=https://your-domain  or the BACKEND_URL env var.
// 10.0.2.2 is the Android emulator's alias for your computer's localhost (debug builds only).
val backendUrl: String = ((findProperty("backendUrl") as String?) ?: System.getenv("BACKEND_URL") ?: "http://10.0.2.2:3000")
    .trim().trimEnd('/')

android {
    namespace = "com.dreamgift.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.dreamgift.app" // change this to your own unique id before publishing
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "BASE_URL", "\"$backendUrl\"")
    }

    if (keystorePath != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartext"] = "true" // lets debug builds talk to http://10.0.2.2:3000
        }
        release {
            manifestPlaceholders["usesCleartext"] = "false"
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystorePath != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    lint {
        abortOnError = false
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.05.01"))
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

// Safety net: never ship a release build that points at a local/insecure server.
gradle.taskGraph.whenReady {
    val releasing = allTasks.any { it.name.contains("Release") && (it.name.startsWith("bundle") || it.name.startsWith("assemble")) }
    if (releasing && !backendUrl.startsWith("https://")) {
        throw GradleException(
            "Release builds need an https backend. Run with -PbackendUrl=https://your-domain " +
                "(or set the BACKEND_URL env var / GitHub repository variable). Current value: $backendUrl"
        )
    }
}
