# Log terbang DJI

Taruh file `DJIFlightRecord_*.txt` di folder ini (boleh di dalam subfolder, misalnya per bulan).
Setiap kali ada log baru, GitHub Actions memprosesnya menjadi GPX, KML, CSV, dan GeoJSON di folder
[`flights/`](../flights/) dan memperbarui [FLIGHTS.md](../FLIGHTS.md).

Unggah tanpa aplikasi: buka <https://github.com/kopluck8/Flight_SMART/upload/main/logs>, seret file log,
lalu tekan **Commit changes**.

Menghapus log dari folder ini juga menghapus hasil olahannya.
