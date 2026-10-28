plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.jrjr3333.arana"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.jrjr3333.arana"
        minSdk = 26
        targetSdk = 35
        versionCode = 31
        versionName = "0.47.0"
    }
    // Si Juan pone su llave en GitHub Secrets, cada versión se instala encima de la anterior sin perder nada.
    val ks = System.getenv("ARANA_KEYSTORE")
    signingConfigs {
        if (ks != null && file(ks).exists()) create("arana") {
            storeFile = file(ks)
            storePassword = System.getenv("ARANA_KEYSTORE_PASS")
            keyAlias = System.getenv("ARANA_KEY_ALIAS")
            keyPassword = System.getenv("ARANA_KEYSTORE_PASS")
        }
    }
    buildTypes {
        getByName("debug") { signingConfigs.findByName("arana")?.let { signingConfig = it } }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
