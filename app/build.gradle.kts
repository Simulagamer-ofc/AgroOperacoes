plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Carimbo das telas que vão dentro do APK (hora do commit): a atualização sem reinstalar só troca por telas mais novas
val carimboTelas: Long = try {
    val p = ProcessBuilder("git", "log", "-1", "--format=%ct").directory(rootDir).redirectErrorStream(true).start()
    val txt = p.inputStream.bufferedReader().readText().trim()
    p.waitFor()
    txt.toLong()
} catch (e: Exception) {
    System.currentTimeMillis() / 1000
}

android {
    namespace = "com.simulagamer.agrooperacoes"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.simulagamer.agrooperacoes"
        minSdk = 26
        targetSdk = 35
        versionCode = 184
        versionName = "1.2.12-beta1"
        buildConfigField("long", "CARIMBO", "${carimboTelas}L")
    }

    buildFeatures { buildConfig = true }

    // Assinatura fixa (opcional): com a chave nos segredos do GitHub, cada APK novo instala POR CIMA do anterior
    // sem desinstalar. Sem os segredos, usa a chave de depuração do próprio servidor (muda a cada compilação).
    signingConfigs {
        getByName("debug") {
            val chave = System.getenv("MERCAPLANT_KEYSTORE")
            if (!chave.isNullOrBlank() && file(chave).exists()) {
                storeFile = file(chave)
                storePassword = System.getenv("MERCAPLANT_KEYSTORE_PASS")
                keyAlias = System.getenv("MERCAPLANT_KEY_ALIAS")
                keyPassword = System.getenv("MERCAPLANT_KEY_PASS")
            }
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
    implementation("androidx.webkit:webkit:1.12.1")
    // Alertas agendados (chegam com o app fechado)
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
