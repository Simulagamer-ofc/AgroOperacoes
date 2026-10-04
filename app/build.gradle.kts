plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura da versão de produção: informada por variáveis de ambiente (ver README).
val releaseKeystore: String? = System.getenv("AGRO_KEYSTORE_PATH")

android {
    namespace = "com.simulagamer.agrooperacoes"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.simulagamer.agrooperacoes"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.3.0-beta1"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("AGRO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("AGRO_KEY_ALIAS")
                keyPassword = System.getenv("AGRO_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
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
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
