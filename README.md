# Alea Fiber Plan

Alea Fiber Plan adalah webapp untuk merancang topologi jaringan fiber optik bercabang dan memperkirakan daya optik pada setiap output. Aplikasi berjalan langsung di browser tanpa proses build atau dependensi tambahan.

## Fitur

- Diagram topologi interaktif dari transmitter hingga output.
- Pengaturan transmitter: daya optik, panjang gelombang, redaman kabel, batas sinyal minimum, loss konektor, dan safety margin.
- Penambahan coupler bertingkat melalui output.
- Pilihan coupler:
  - FBT dengan rasio 1/99 hingga 50/50.
  - PLC dengan pembagian 1:2 hingga 1:128.
  - Mode pass-through tanpa pembagian.
- Pengaturan panjang feeder dan kabel cabang, mulai dari 0,01 km.
- Perhitungan daya dan status terhadap target secara langsung.
- Geser dan zoom diagram.
- Ekspor rincian output ke CSV dan laporan siap cetak/simpan sebagai PDF.
- Penyimpanan konfigurasi jaringan secara lokal di browser.

## Menjalankan aplikasi

1. Unduh atau clone repository ini.
2. Buka `index.html` di browser modern.

Tidak diperlukan instalasi package, server, atau proses kompilasi. Untuk pengembangan, buka folder proyek di editor kode dan muat ulang halaman browser setelah mengubah file.

## Cara menggunakan

1. Atur parameter transmitter pada panel pengaturan.
2. Pilih output pada diagram, lalu tekan **Tambahkan splitter** untuk membuat coupler.
3. Pilih jenis dan rasio FBT/PLC melalui dropdown coupler.
4. Pilih kabel atau output untuk mengatur panjang kabelnya.
5. Geser diagram dengan drag atau satu jari. Di ponsel, cubit dengan dua jari untuk zoom; di desktop, gunakan roda mouse atau tombol **− / +**. Tombol **Pas** mengembalikan ukuran tampilan.
6. Gunakan **Ekspor CSV** untuk mengunduh tabel per output. Untuk PDF, pilih **Ekspor PDF**, lalu pilih **Simpan sebagai PDF** pada dialog cetak browser.

Tombol **Atur ulang** mengembalikan parameter dan topologi ke kondisi awal tanpa coupler.

## Model perhitungan

Perhitungan daya dilakukan dalam dBm. Untuk setiap jalur, aplikasi menerapkan redaman kabel pada panjang feeder dan kabel cabang, loss konektor pada setiap link, pembagian daya coupler, serta insertion loss coupler yang dimasukkan pengguna.

- FBT membagi daya berdasarkan rasio port pertama dan port kedua.
- PLC membagi daya rata ke seluruh port.
- Pass-through meneruskan daya tanpa pembagian atau insertion loss coupler.
- Target kelayakan output dihitung sebagai **Min end signal + Safety margin**.

Nilai redaman kabel adalah satu nilai global yang digunakan untuk semua panjang gelombang. Pembagian ideal splitter dan estimasi insertion loss bukan pengganti spesifikasi perangkat sebenarnya.

## Catatan

Hasil aplikasi merupakan estimasi untuk perencanaan awal, bukan sertifikasi atau pengukuran link. Sesuaikan redaman dan loss komponen dengan datasheet kabel/perangkat yang digunakan, lalu verifikasi dengan alat ukur di lapangan.

Konfigurasi jaringan disimpan di `localStorage` browser pada perangkat yang digunakan. Data tidak otomatis tersinkron ke perangkat atau browser lain.

## Teknologi

- HTML
- CSS
- JavaScript vanilla

## Lisensi

Belum ada lisensi open-source yang ditetapkan. Hak penggunaan dan distribusi mengikuti ketentuan pemilik repository.
