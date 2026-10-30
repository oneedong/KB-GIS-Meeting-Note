#!/usr/bin/env bash
# KB GIS Meeting Note 안드로이드 APK 빌드 — Android SDK build-tools 만 쓴다(Gradle 없음).
# GitHub Actions(ubuntu-latest)에는 SDK 가 깔려 있다(.github/workflows/android.yml).
#   VERSION_CODE=12 bash android/build.sh   → android/build/KB-GIS-Meeting-Note.apk
# 서명 키: KEYSTORE·KS_PASS 를 주면 그 키로, 없으면 이번 빌드용 키를 새로 만든다.
set -euo pipefail
cd "$(dirname "$0")"

SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:?ANDROID_HOME 이 필요합니다}}
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
PLAT=$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)/android.jar
VC=${VERSION_CODE:-1}
VN=${VERSION_NAME:-1.0.$VC}
echo "build-tools: $BT"
echo "platform:    $PLAT"
echo "version:     $VN ($VC)"

OUT=build
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

# 1) 리소스·매니페스트
"$BT/aapt2" compile --dir res -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLAT" --manifest AndroidManifest.xml --java "$OUT/gen" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VC" --version-name "$VN" "$OUT/res.zip"

# 2) 자바 → dex
javac -encoding UTF-8 --release 11 -nowarn -classpath "$PLAT" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$PLAT" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

# 3) 묶기·정렬·서명
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j ../unsigned.apk classes.dex)
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
if [ -z "${KEYSTORE:-}" ]; then
  KEYSTORE="$OUT/release.jks"; KS_PASS=$(openssl rand -hex 16)
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias app \
    -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=KB GIS Meeting Note" >/dev/null
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias app \
  --out "$OUT/KB-GIS-Meeting-Note.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose --print-certs "$OUT/KB-GIS-Meeting-Note.apk"
ls -l "$OUT/KB-GIS-Meeting-Note.apk"
