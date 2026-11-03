plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

android {
    namespace = "nu.binge.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "nu.binge.tv"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    // En fast signeringsnyckel för testbygget, så en ny APK går att lägga över den gamla på TV:n utan
    // att appens inloggning försvinner. Nyckeln ligger bara som GitHub-hemlighet och kommer in via
    // TV_DEBUG_KEYSTORE; utan den signeras bygget med utvecklarmaskinens egen nyckel.
    val fixedDebugKeystore = System.getenv("TV_DEBUG_KEYSTORE")?.let(::file)?.takeIf { it.exists() }
    if (fixedDebugKeystore != null) {
        signingConfigs.create("fixedDebug") {
            storeFile = fixedDebugKeystore
            storePassword = "bingetv-debug"
            keyAlias = "bingetv"
            keyPassword = "bingetv-debug"
        }
    }

    buildTypes {
        debug {
            signingConfigs.findByName("fixedDebug")?.let { signingConfig = it }
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-functions")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-appcheck-playintegrity")
    // Testläge för App Check i testvarianten. Release använder Play Integrity.
    debugImplementation("com.google.firebase:firebase-appcheck-debug")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.tv:tv-material:1.0.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("io.coil-kt:coil-compose:2.7.0")

    testImplementation("junit:junit:4.13.2")
}
