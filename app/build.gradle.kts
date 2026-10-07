plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.simulagamer.agrooperacoes"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.simulagamer.agrooperacoes"
        minSdk = 26
        targetSdk = 35
        versionCode = 16
        versionName = "0.15.0-beta1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
}
