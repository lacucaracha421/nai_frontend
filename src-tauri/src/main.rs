// Release builds open no console window next to the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main(){nai_frontend_lib::run();}
