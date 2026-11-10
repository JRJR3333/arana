import json, csv, sys, unicodedata
from shapely.geometry import shape, mapping
geo_path, csv_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
DIST = {
 "Centro":["Palacio","Embajadores","Cortes","Justicia","Universidad","Sol"],
 "Arganzuela":["Imperial","Acacias","Chopera","Legazpi","Delicias","Palos de Moguer","Atocha"],
 "Retiro":["Pacífico","Adelfas","Estrella","Ibiza","Jerónimos","Niño Jesús"],
 "Salamanca":["Recoletos","Goya","Fuente del Berro","Guindalera","Lista","Castellana"],
 "Chamartín":["El Viso","Prosperidad","Ciudad Jardín","Hispanoamérica","Nueva España","Castilla"],
 "Tetuán":["Bellas Vistas","Cuatro Caminos","Castillejos","Almenara","Valdeacederas","Berruguete"],
 "Chamberí":["Gaztambide","Arapiles","Trafalgar","Almagro","Rios Rosas","Vallehermoso"],
 "Fuencarral-El Pardo":["El Pardo","Fuentelareina","Peñagrande","Pilar","La Paz","Valverde","Mirasierra","El Goloso"],
 "Moncloa-Aravaca":["Casa de Campo","Argüelles","Ciudad Universitaria","Valdezarza","Valdemarín","El Plantío","Aravaca"],
 "Latina":["Cármenes","Puerta del Angel","Lucero","Aluche","Campamento","Cuatro Vientos","Aguilas"],
 "Carabanchel":["Comillas","Opañel","San Isidro","Vista Alegre","Puerta Bonita","Buenavista","Abrantes"],
 "Usera":["Orcasitas","Orcasur","San Fermín","Almendrales","Moscardó","Zofío","Pradolongo"],
 "Puente de Vallecas":["Entrevías","San Diego","Palomeras Bajas","Palomeras Sureste","Portazgo","Numancia"],
 "Moratalaz":["Pavones","Horcajo","Marroquina","Media Legua","Fontarrón","Vinateros"],
 "Ciudad Lineal":["Ventas","Pueblo Nuevo","Quintana","Concepción","San Pascual","San Juan Bautista","Colina","Atalaya","Costillares"],
 "Hortaleza":["Palomas","Piovera","Canillas","Pinar del Rey","Apostol Santiago","Valdefuentes"],
 "Villaverde":["San Andrés","San Cristobal","Butarque","Los Rosales","Los Angeles"],
 "Villa de Vallecas":["Casco Histórico de Vallecas","Santa Eugenia"],
 "Vicálvaro":["Casco Histórico de Vicálvaro","Ambroz"],
 "San Blas-Canillejas":["Simancas","Hellín","Amposta","Arcos","Rosas","Rejas","Canillejas","Salvador"],
 "Barajas":["Alameda de Osuna","Aeropuerto","Casco Histórico de Barajas","Timón","Corralejos"],
}
b2d = {b:d for d,bs in DIST.items() for b in bs}
NICE = {"Puerta del Angel":"Puerta del Ángel","Aguilas":"Las Águilas","Rios Rosas":"Ríos Rosas","Los Angeles":"Los Ángeles","San Cristobal":"San Cristóbal","Apostol Santiago":"Apóstol Santiago","Cármenes":"Los Cármenes","San Andrés":"San Andrés (Villaverde Alto)","Valdefuentes":"Valdefuentes (Sanchinarro, Virgen del Cortijo)","Valverde":"Valverde (Las Tablas, Tres Olivos)","El Goloso":"El Goloso (Montecarmelo)","Casco Histórico de Vallecas":"Casco Hist. Vallecas (incl. Ensanche)","Casco Histórico de Vicálvaro":"Casco Hist. Vicálvaro (incl. Cañaveral, Valdebernardo)","Timón":"Timón","Palomas":"Palomas"}
g = json.load(open(geo_path))
barrios=[]
for f in g["features"]:
    n=f["properties"]["name"]; assert n in b2d, n
    s=shape(f["geometry"]).simplify(0.00025, preserve_topology=True)
    c=s.representative_point()
    polys=[s] if s.geom_type=="Polygon" else list(s.geoms)
    rings=[[ [round(x,4),round(y,4)] for x,y in p.exterior.coords] for p in polys if p.area>1e-7]
    barrios.append({"n":NICE.get(n,n),"d":b2d[n],"c":[round(c.x,5),round(c.y,5)],"r":rings})
assert len(barrios)==128
def title(s):
    s=s.strip().lower(); small={"de","del","la","las","los","el","y"}
    w=[x if (i>0 and x in small) else x[:1].upper()+x[1:] for i,x in enumerate(s.split())]
    return " ".join(w)
st={}
for r in csv.DictReader(open(csv_path,encoding="utf-8")):
    if r["location_type"]!="0": continue
    k=r["stop_id"]
    e=st.setdefault(k,{"n":title(r["stop_name"]),"t":"ML" if r["transport_name"]=="metro_ligero" else "M","l":set(),"y":float(r["stop_lat"]),"x":float(r["stop_lon"]),"a":r["estacion_accesible"]=="1.0"})
    e["l"].add(r["line_id"])
# merge same-name stations within 300 m
import math
merged={}
for e in st.values():
    key=(e["n"],e["t"])
    if key in merged:
        m=merged[key]; m["l"]|=e["l"]; m["a"]=m["a"] or e["a"]
    else: merged[key]=dict(e)
stations=[{"n":e["n"],"t":e["t"],"l":sorted(e["l"],key=lambda v:(len(v),v)),"y":round(e["y"],5),"x":round(e["x"],5),"a":e["a"]} for e in merged.values()]
json.dump({"barrios":barrios,"stations":stations},open(out,"w"),ensure_ascii=False,separators=(",",":"))
import os; print(len(stations),"stations", os.path.getsize(out),"bytes")
print(sorted({s["n"] for s in stations})[:400])
