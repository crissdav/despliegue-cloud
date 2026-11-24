-- Esquema del Diario personal.
-- La app lo crea sola al arrancar, pero puedes ejecutarlo a mano desde el EC2:
--   mysql -h <ENDPOINT_RDS> -u admin -p < db/init.sql

-- Sin esto, el cliente mysql puede leer el archivo como latin1 y los acentos salen como "Ã©".
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS diario CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE diario;

CREATE TABLE IF NOT EXISTS entradas (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  fecha          DATE         NOT NULL,
  titulo         VARCHAR(150) NOT NULL,
  contenido      TEXT         NOT NULL,
  animo          ENUM('feliz','tranquilo','neutral','triste','enojado','ansioso') NOT NULL DEFAULT 'neutral',
  creado_en      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos de ejemplo (solo si la tabla está vacía)
INSERT INTO entradas (fecha, titulo, contenido, animo)
SELECT * FROM (
  SELECT CURDATE() AS fecha, 'Mi primer despliegue en AWS' AS titulo,
         'Hoy levanté una instancia EC2 y conecté mi app a RDS. ¡Funcionó!' AS contenido, 'feliz' AS animo
  UNION ALL
  SELECT CURDATE() - INTERVAL 1 DAY, 'Peleando con el Security Group',
         'La app no conectaba a la base. Era la regla del puerto 3306 en el SG de RDS.', 'ansioso'
) AS ejemplo
WHERE NOT EXISTS (SELECT 1 FROM entradas);
